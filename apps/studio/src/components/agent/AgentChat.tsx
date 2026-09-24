import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { gsap } from 'gsap';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type {
  AgentEvent,
  AgentSessionConfiguration,
  AgentRuntimeSnapshot,
  AgentSessionState,
  AgentSessionSummary,
} from '@seevee/agent-runtime';
import './agent-chat.css';

interface AgentChatProps {
  workspaceId: string;
}
const ACTIVE_AGENT_SESSION_KEY = 'seevee.active-agent-session';

interface LocalPrompt {
  id: string;
  sessionId: string;
  text: string;
  createdAt: string;
}


interface TimelineItem {
  id: string;
  kind: 'assistant' | 'reasoning' | 'plan' | 'tool' | 'approval' | 'error';
  title: string;
  text: string;
  status: string;
  approvalId: string | null;
  decision: string | null;
  raw: unknown;
  turnId?: string | null;
}

export interface AgentChatSummary {
  phase: 'idle' | 'working' | 'waiting' | 'completed' | 'failed' | 'cancelled';
  label: string;
  usage: string | null;
  activeTools: number;
  validation: 'passed' | 'failed' | null;
}

interface AgentEventEnvelope {
  type: 'agent.event';
  event: AgentEvent;
}

interface WorkspaceEventEnvelope {
  type: string;
  [key: string]: unknown;
}


function jsonHeaders(): HeadersInit {
  return { 'content-type': 'application/json', 'x-seevee-agent': '1' };
}

async function readJson<T>(response: Response): Promise<T> {
  const payload = await response.json() as T & { ok?: boolean; reason?: string };
  if (!response.ok || payload.ok === false) {
    throw new Error(payload.reason ?? `Agent request failed with status ${response.status}.`);
  }
  return payload;
}

function eventState(event: AgentEvent, current: AgentSessionState): AgentSessionState {
  if (event.type === 'approval.requested') return 'waiting-approval';
  if (event.type === 'approval.resolved' && current === 'waiting-approval') return 'running';
  if (event.type === 'turn.started' || event.type === 'message.started' || event.type === 'tool.started') return 'running';
  if (event.type === 'turn.completed') return 'completed';
  if (event.type === 'turn.failed' || event.type === 'error') return 'failed';
  if (event.type === 'turn.cancelled') return 'cancelled';
  return current;
}

function formatUsage(data: Record<string, unknown>): string {
  const total = typeof data['totalTokens'] === 'number' ? data['totalTokens'] : null;
  const context = typeof data['contextWindow'] === 'number' ? data['contextWindow'] : null;
  const used = typeof data['used'] === 'number' ? data['used'] : null;
  const size = typeof data['size'] === 'number' ? data['size'] : null;
  const input = typeof data['inputTokens'] === 'number' ? data['inputTokens'] : null;
  const output = typeof data['outputTokens'] === 'number' ? data['outputTokens'] : null;
  const costValue = data['cost'];
  const costRecord = typeof costValue === 'object' && costValue !== null ? costValue as Record<string, unknown> : null;
  const cost = typeof data['cost'] === 'number'
    ? data['cost']
    : typeof costRecord?.['amount'] === 'number' ? costRecord['amount'] : null;
  const parts: string[] = [];
  if ((used !== null || total !== null) && (size !== null || context !== null)) {
    parts.push(`Context ${(used ?? total ?? 0).toLocaleString()} / ${(size ?? context ?? 0).toLocaleString()}`);
  } else if (used !== null || total !== null) {
    parts.push(`${(used ?? total ?? 0).toLocaleString()} tokens`);
  }
  if (input !== null || output !== null) parts.push(`${(input ?? 0).toLocaleString()} in · ${(output ?? 0).toLocaleString()} out`);
  if (cost !== null) parts.push(`$${cost.toFixed(4)}`);
  return parts.join(' · ') || 'Usage updated.';
}

export function summarizeAgentEvents(events: AgentEvent[], sessionState: AgentSessionState): AgentChatSummary {
  let phase: AgentChatSummary['phase'] = sessionState === 'running'
    ? 'working'
    : sessionState === 'waiting-approval'
      ? 'waiting'
      : sessionState === 'completed'
        ? 'completed'
        : sessionState === 'failed'
          ? 'failed'
          : sessionState === 'cancelled'
            ? 'cancelled'
            : 'idle';
  let label = phase === 'working' ? 'Working' : phase === 'waiting' ? 'Approval needed' : phase === 'completed' ? 'Completed' : phase === 'failed' ? 'Needs attention' : phase === 'cancelled' ? 'Stopped' : 'Ready';
  let usage: string | null = null;
  let validation: AgentChatSummary['validation'] = null;
  let currentTurnId: string | null = null;
  let currentIssue: { turnId: string | null; label: string } | null = null;
  const tools = new Map<string, string>();

  for (const event of events) {
    const data = event.data as Record<string, unknown>;
    if (event.type === 'usage.updated') usage = formatUsage(data);
    if (event.type === 'turn.started') {
      currentTurnId = event.turnId;
      currentIssue = null;
      phase = 'working';
      label = 'Thinking';
    }
    if (event.type === 'turn.queued') {
      phase = 'working';
      label = 'Queued';
    }
    if (event.type === 'message.started') {
      phase = 'working';
      label = 'Thinking';
    }
    if (event.type === 'approval.requested') {
      phase = 'waiting';
      label = 'Approval needed';
    }
    if (event.type === 'approval.resolved') {
      const decision = typeof data['decision'] === 'string' ? data['decision'] : '';
      if (decision === 'deny' || decision === 'cancel') {
        currentIssue = { turnId: currentTurnId, label: 'Tool approval denied' };
        phase = 'failed';
        label = currentIssue.label;
      } else if (currentIssue === null) {
        phase = 'working';
        label = 'Continuing';
      }
    }
    if (event.type === 'tool.started' || event.type === 'tool.updated' || event.type === 'tool.completed') {
      const callId = typeof data['callId'] === 'string' ? data['callId'] : event.turnId ?? `${event.seq}`;
      const toolName = typeof data['name'] === 'string' ? data['name'] : 'tool';
      const status = typeof data['status'] === 'string' ? data['status'] : event.type === 'tool.completed' ? 'completed' : 'running';
      if (event.type === 'tool.completed') {
        tools.delete(callId);
        if (status === 'failed' || status === 'declined' || status === 'cancelled' || data['error'] !== undefined) {
          currentIssue = { turnId: currentTurnId, label: `Tool failed: ${toolName}` };
          phase = 'failed';
          label = currentIssue.label;
        }
      } else {
        tools.set(callId, toolName);
        if (currentIssue === null) {
          phase = 'working';
          label = `Running ${toolName}`;
        }
      }
    }
    if (event.type === 'validation.started' && currentIssue === null) {
      phase = 'working';
      label = 'Validating workspace';
    }
    if (event.type === 'validation.completed') {
      validation = data['status'] === 'passed' ? 'passed' : 'failed';
      if (validation === 'failed' && currentIssue === null) {
        phase = 'failed';
        label = 'Validation needs attention';
      }
    }
    if (event.type === 'turn.completed') {
      tools.clear();
      if (currentIssue !== null && (currentIssue.turnId === null || currentIssue.turnId === event.turnId)) {
        phase = 'failed';
        label = currentIssue.label;
      } else {
        phase = 'completed';
        label = validation === 'passed' ? 'Completed · workspace valid' : 'Completed';
      }
    }
    if (event.type === 'turn.failed' || event.type === 'error') {
      phase = 'failed';
      label = 'Needs attention';
    }
    if (event.type === 'turn.cancelled') {
      phase = 'cancelled';
      label = 'Stopped';
      tools.clear();
    }
  }

  if (phase === 'working' && tools.size > 0 && currentIssue === null) {
    const [toolName] = tools.values();
    label = `Running ${toolName ?? 'tool'}`;
  }
  return { phase, label, usage, activeTools: tools.size, validation };
}

function formatPlan(data: Record<string, unknown>): string {
  const entries = Array.isArray(data['entries']) ? data['entries'] : [];
  if (entries.length === 0) return 'Plan updated.';
  return entries.map((entry) => {
    const record = typeof entry === 'object' && entry !== null ? entry as Record<string, unknown> : {};
    const status = typeof record['status'] === 'string' ? record['status'] : 'pending';
    const content = typeof record['content'] === 'string' ? record['content'] : 'Plan step';
    const marker = status === 'completed' ? '✓' : status === 'inProgress' ? '•' : '○';
    return `${marker} ${content}`;
  }).join('\n');
}

function MarkdownMessage({ text }: { text: string }) {
  return (
    <div className="agent-markdown">
      <ReactMarkdown remarkPlugins={[remarkGfm]} skipHtml>{text}</ReactMarkdown>
    </div>
  );
}

export function buildTimeline(events: AgentEvent[]): TimelineItem[] {
  const items: TimelineItem[] = [];
  const tools = new Map<string, TimelineItem>();
  const approvals = new Map<string, TimelineItem>();
  let assistant: TimelineItem | null = null;
  let reasoning: TimelineItem | null = null;
  let plan: TimelineItem | null = null;

  for (const event of events) {
    const data = event.data as Record<string, unknown>;
    switch (event.type) {
      case 'message.started':
        assistant = {
          id: `assistant-${event.seq}`,
          kind: 'assistant',
          title: 'Assistant',
          text: typeof data['text'] === 'string' ? data['text'] : '',
          status: 'streaming',
          approvalId: null,
          decision: null,
          raw: data,
          turnId: event.turnId,
        };
        reasoning = null;
        items.push(assistant);
        break;
      case 'message.delta':
        if (assistant === null) {
          assistant = {
            id: `assistant-${event.seq}`,
            kind: 'assistant',
            title: 'Assistant',
            text: '',
            status: 'streaming',
            approvalId: null,
            decision: null,
            raw: {},
            turnId: event.turnId,
          };
          items.push(assistant);
        }
        assistant.text += typeof data['delta'] === 'string' ? data['delta'] : '';
        break;
      case 'message.completed':
        if (assistant !== null && assistant.text.length === 0 && typeof data['text'] === 'string') assistant.text = data['text'];
        if (assistant !== null) assistant.status = 'completed';
        break;
      case 'reasoning.delta': {
        if (reasoning === null) {
          reasoning = {
            id: `reasoning-${event.seq}`,
            kind: 'reasoning',
            title: 'Thinking',
            text: '',
            status: 'streaming',
            approvalId: null,
            decision: null,
            raw: {},
            turnId: event.turnId,
          };
          items.push(reasoning);
        }
        reasoning.text += typeof data['delta'] === 'string' ? data['delta'] : '';
        break;
      }
      case 'plan.updated':
        if (plan === null) {
          plan = {
            id: `plan-${event.turnId ?? event.seq}`,
            kind: 'plan',
            title: 'Plan',
            text: '',
            status: 'active',
            approvalId: null,
            decision: null,
            raw: data,
            turnId: event.turnId,
          };
          items.push(plan);
        }
        plan.raw = data;
        plan.text = formatPlan(data);
        break;
      case 'tool.started':
      case 'tool.updated':
      case 'tool.completed': {
        const callId = typeof data['callId'] === 'string' ? data['callId'] : `tool-${event.seq}`;
        let item = tools.get(callId);
        if (item === undefined) {
          item = {
            id: `tool-${callId}`,
            kind: 'tool',
            title: typeof data['name'] === 'string' ? data['name'] : 'Tool call',
            text: '',
            status: typeof data['status'] === 'string' ? data['status'] : 'running',
            approvalId: null,
            decision: null,
            raw: data,
            turnId: event.turnId,
          };
          tools.set(callId, item);
          items.push(item);
        }
        item.status = typeof data['status'] === 'string'
          ? data['status']
          : event.type === 'tool.completed' ? 'completed' : 'running';
        if (typeof data['delta'] === 'string') item.text += data['delta'];
        if (typeof data['output'] === 'string') item.text = data['output'];
        item.raw = { ...(item.raw as Record<string, unknown>), ...data };
        break;
      }
      case 'approval.requested': {
        const approvalId = event.approvalId ?? `approval-${event.seq}`;
        const item: TimelineItem = {
          id: `approval-${approvalId}`,
          kind: 'approval',
          title: typeof data['title'] === 'string' ? data['title'] : 'Agent approval required',
          text: typeof data['description'] === 'string' ? data['description'] : '',
          status: 'pending',
          approvalId,
          decision: null,
          raw: data,
          turnId: event.turnId,
        };
        approvals.set(approvalId, item);
        items.push(item);
        break;
      }
      case 'approval.resolved': {
        const approvalId = event.approvalId ?? '';
        const item = approvals.get(approvalId);
        if (item !== undefined) {
          item.status = 'resolved';
          item.decision = typeof data['decision'] === 'string' ? data['decision'] : 'resolved';
        }
        break;
      }
      case 'turn.completed':
        for (const item of items) {
          if (item.status === 'streaming') item.status = 'completed';
        }
        assistant = null;
        reasoning = null;
        break;
      case 'turn.cancelled':
        for (const item of items) {
          if (item.status === 'streaming') item.status = 'cancelled';
        }
        assistant = null;
        reasoning = null;
        break;
      case 'usage.updated':
      case 'turn.queued':
      case 'turn.started':
      case 'workspace.changed':
      case 'validation.started':
      case 'subactivity.updated':
      case 'session.state':
        break;
      case 'turn.failed':
      case 'validation.completed':
        if (event.type === 'validation.completed' && data['status'] !== 'failed') break;
        items.push({
          id: `error-${event.seq}`,
          kind: 'error',
          title: event.type === 'validation.completed' ? 'Workspace validation needs attention' : 'Agent run needs attention',
          text: typeof data['message'] === 'string'
            ? data['message']
            : event.type === 'validation.completed'
              ? `${String(data['failures'] instanceof Array ? data['failures'].length : 0)} validation checks failed.`
              : 'The agent could not complete this run.',
          status: 'failed',
          approvalId: null,
          decision: null,
          raw: data,
          turnId: event.turnId,
        });
        break;
      case 'error':
        items.push({
          id: `error-${event.seq}`,
          kind: 'error',
          title: 'Agent error',
          text: typeof data['message'] === 'string' ? data['message'] : 'Unknown agent error.',
          status: 'failed',
          approvalId: null,
          decision: null,
          raw: data,
          turnId: event.turnId,
        });
        break;
      default:
        break;
    }
  }
  for (let index = items.length - 1; index >= 0; index -= 1) {
    const item = items[index];
    if (item.kind !== 'assistant' || item.status !== 'completed' || item.turnId === null || item.turnId === undefined) continue;
    let insertIndex = -1;
    for (let cursor = items.length - 1; cursor > index; cursor -= 1) {
      const candidate = items[cursor];
      if (candidate.turnId === item.turnId && (candidate.kind === 'tool' || candidate.kind === 'approval' || candidate.kind === 'error')) {
        insertIndex = cursor;
        break;
      }
    }
    if (insertIndex < 0) continue;
    const [moved] = items.splice(index, 1);
    if (moved !== undefined) items.splice(insertIndex, 0, moved);
  }
  return items;
}

export default function AgentChat({ workspaceId }: AgentChatProps) {
  const rootRef = useRef<HTMLElement>(null);
  const timelineRef = useRef<HTMLDivElement>(null);
  const lastEventIdRef = useRef(0);
  const [sessions, setSessions] = useState<AgentSessionSummary[]>([]);
  const [events, setEvents] = useState<AgentEvent[]>([]);
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
  const [configuration, setConfiguration] = useState<AgentSessionConfiguration | null>(null);
  const [configurationLoading, setConfigurationLoading] = useState(false);
  const [composer, setComposer] = useState('');
  const [documentContext, setDocumentContext] = useState({ enabled: false, name: 'Active CV' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [localPrompts, setLocalPrompts] = useState<LocalPrompt[]>([]);
  const [elicitationValues, setElicitationValues] = useState<Record<string, string>>({});
  const userScrolledAwayRef = useRef(false);
  const initializedScrollSessionRef = useRef<string | null>(null);

  const selectedSession = sessions.find((session) => session.id === selectedSessionId) ?? null;
  const selectedEvents = useMemo(
    () => events.filter((event) => event.sessionId === selectedSessionId),
    [events, selectedSessionId],
  );
  const timeline = useMemo(() => buildTimeline(selectedEvents), [selectedEvents]);
  const prompts = localPrompts.filter((prompt) => prompt.sessionId === selectedSessionId);
  const chatSummary = useMemo(
    () => summarizeAgentEvents(selectedEvents, selectedSession?.state ?? 'idle'),
    [selectedEvents, selectedSession?.state],
  );

  const refreshSnapshot = useCallback(async (refreshProviders = false) => {
    const response = await fetch(`/api/agents${refreshProviders ? '?refresh=1' : ''}`, { cache: 'no-store' });
    const payload = await readJson<{ snapshot: AgentRuntimeSnapshot }>(response);
    setSessions(payload.snapshot.sessions);
    setEvents((current) => {
      const bySeq = new Map(current.map((event) => [event.seq, event]));
      for (const event of payload.snapshot.events) bySeq.set(event.seq, event);
      return [...bySeq.values()].sort((a, b) => a.seq - b.seq);
    });
    let storedSessionId: string | null = null;
    try {
      storedSessionId = localStorage.getItem(ACTIVE_AGENT_SESSION_KEY);
    } catch {
      storedSessionId = null;
    }
    const selected = payload.snapshot.sessions.find((session) => session.id === storedSessionId)
      ?? payload.snapshot.sessions.at(-1);
    setSelectedSessionId(selected?.id ?? null);
  }, []);

  const loadSessionConfiguration = useCallback(async (sessionId: string): Promise<void> => {
    setConfigurationLoading(true);
    try {
      const response = await fetch(`/api/agents/session/${encodeURIComponent(sessionId)}/options`, { cache: 'no-store' });
      const payload = await readJson<{ configuration: AgentSessionConfiguration }>(response);
      setConfiguration(payload.configuration);
    } finally {
      setConfigurationLoading(false);
    }
  }, []);

  useEffect(() => {
    if (selectedSessionId === null) {
      setConfiguration(null);
      return;
    }
    void loadSessionConfiguration(selectedSessionId).catch((reason) => {
      setError(reason instanceof Error ? reason.message : String(reason));
    });
  }, [loadSessionConfiguration, selectedSessionId]);

  useEffect(() => {
    void refreshSnapshot(true).catch((reason) => setError(reason instanceof Error ? reason.message : String(reason)));
    const source = new EventSource('/api/events');
    source.onmessage = (message) => {
      const envelope = JSON.parse(message.data) as WorkspaceEventEnvelope;
      if (envelope.type !== 'agent.event') return;
      const event = (envelope as AgentEventEnvelope).event;
      if (event.seq <= lastEventIdRef.current) return;
      lastEventIdRef.current = event.seq;
      setEvents((current) => [...current.filter((item) => item.seq !== event.seq), event].sort((a, b) => a.seq - b.seq));
      setSessions((current) => current.map((session) => session.id === event.sessionId
        ? { ...session, state: eventState(event, session.state), lastActivityAt: event.occurredAt }
        : session));
      if (event.type === 'session.created') void refreshSnapshot();
    };
    source.onerror = () => setError('Live agent event stream disconnected. Reconnecting…');
    const selectSession = (message: Event) => {
      const session = (message as CustomEvent<AgentSessionSummary>).detail;
      setSessions((current) => [...current.filter((item) => item.id !== session.id), session]);
      setSelectedSessionId(session.id);
      try {
        localStorage.setItem(ACTIVE_AGENT_SESSION_KEY, session.id);
      } catch {
        // The current page still receives the selected session.
      }
    };
    window.addEventListener('seevee:agent-session-selected', selectSession);
    return () => {
      source.close();
      window.removeEventListener('seevee:agent-session-selected', selectSession);
    };
  }, [refreshSnapshot]);

  useLayoutEffect(() => {
    const root = rootRef.current;
    if (root === null) return;
    const media = gsap.matchMedia();
    media.add('(prefers-reduced-motion: no-preference)', () => {
      const lastItem = root.querySelector<HTMLElement>('[data-last-timeline-item="true"]');
      if (lastItem !== null) {
        gsap.fromTo(lastItem, { autoAlpha: 0, y: 10, scale: 0.985 }, { autoAlpha: 1, y: 0, scale: 1, duration: 0.2, ease: 'power2.out' });
      }
      const approval = root.querySelector<HTMLElement>('[data-pending-approval="true"]');
      if (approval !== null) {
        gsap.fromTo(approval, { boxShadow: '0 0 0 rgba(0,0,0,0)' }, { boxShadow: '0 0 0 2px rgba(220, 165, 65, .22)', duration: 0.7, repeat: 3, yoyo: true, ease: 'sine.inOut' });
      }
      const contextChip = root.querySelector<HTMLElement>('.agent-context-chip');
      if (contextChip !== null) {
        gsap.fromTo(contextChip, { autoAlpha: 0, scale: 0.92, y: -4 }, { autoAlpha: 1, scale: 1, y: 0, duration: 0.18, ease: 'power2.out' });
      }
      const status = root.querySelector<HTMLElement>('.agent-chat-status');
      const statusOrb = root.querySelector<HTMLElement>('.agent-status-orb');
      if (status !== null) {
        gsap.fromTo(status, { autoAlpha: 0.55, y: -3 }, { autoAlpha: 1, y: 0, duration: 0.18, ease: 'power2.out' });
      }
      if (statusOrb !== null && (chatSummary.phase === 'working' || chatSummary.phase === 'waiting')) {
        gsap.to(statusOrb, { scale: 1.18, opacity: 0.62, duration: chatSummary.phase === 'waiting' ? 1.1 : 0.75, repeat: -1, yoyo: true, ease: 'sine.inOut' });
      }
    });
    return () => media.revert();
  }, [timeline.length, selectedSessionId, documentContext.enabled, chatSummary.phase, chatSummary.label, chatSummary.usage]);

  useLayoutEffect(() => {
    const container = timelineRef.current;
    if (container === null) return;
    const sessionChanged = initializedScrollSessionRef.current !== selectedSessionId;
    if (sessionChanged) {
      initializedScrollSessionRef.current = selectedSessionId;
      userScrolledAwayRef.current = false;
    }
    if (sessionChanged || !userScrolledAwayRef.current) {
      requestAnimationFrame(() => {
        container.scrollTo({ top: container.scrollHeight, behavior: sessionChanged ? 'auto' : 'smooth' });
      });
    }
  }, [selectedEvents, prompts.length, selectedSessionId]);


  function toggleDocumentContext(): void {
    const name = document.querySelector<HTMLElement>('#preview-name')?.textContent?.trim() || 'Active CV';
    setDocumentContext((current) => ({ enabled: !current.enabled, name }));
  }


  async function updateConfiguration(patch: { model?: string; permissionMode?: string }): Promise<void> {
    if (selectedSessionId === null) return;
    setConfigurationLoading(true);
    setError(null);
    try {
      const response = await fetch(`/api/agents/session/${encodeURIComponent(selectedSessionId)}`, {
        method: 'PATCH',
        headers: jsonHeaders(),
        body: JSON.stringify(patch),
      });
      const payload = await readJson<{ session: AgentSessionSummary }>(response);
      setSessions((current) => current.map((session) => session.id === payload.session.id ? payload.session : session));
      await loadSessionConfiguration(selectedSessionId);
      window.dispatchEvent(new CustomEvent('seevee:agent-configuration-updated', { detail: { sessionId: selectedSessionId } }));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setConfigurationLoading(false);
    }
  }
  async function sendPrompt(): Promise<void> {
    const text = composer.trim();
    const requestText = documentContext.enabled ? `Active Seevee document: ${documentContext.name}\n\n${text}` : text;
    const sessionId = selectedSessionId;
    if (text.length === 0) return;
    if (sessionId === null) {
      window.dispatchEvent(new CustomEvent('seevee:open-settings', { detail: 'agents' }));
      return;
    }
    const promptId = crypto.randomUUID();
    setLocalPrompts((current) => [...current, { id: promptId, sessionId, text, createdAt: new Date().toISOString() }]);
    setComposer('');
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/agents/session/${encodeURIComponent(sessionId)}/prompt`, {
        method: 'POST',
        headers: jsonHeaders(),
        body: JSON.stringify({ text: requestText, delivery: 'auto' }),
      });
      await readJson(response);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(false);
    }
  }

  async function interrupt(): Promise<void> {
    if (selectedSessionId === null) return;
    setBusy(true);
    try {
      const response = await fetch(`/api/agents/session/${encodeURIComponent(selectedSessionId)}/interrupt`, {
        method: 'POST',
        headers: jsonHeaders(),
      });
      await readJson(response);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(false);
    }
  }

  async function resolveApproval(approvalId: string, decision: 'allow-once' | 'allow-session' | 'deny' | 'cancel'): Promise<void> {
    if (selectedSessionId === null) return;
    setBusy(true);
    try {
      const rawValue = elicitationValues[approvalId];
      let value: unknown;
      if (rawValue !== undefined && rawValue.trim().length > 0) {
        value = JSON.parse(rawValue) as unknown;
      }
      const response = await fetch(`/api/agents/session/${encodeURIComponent(selectedSessionId)}/approval`, {
        method: 'POST',
        headers: jsonHeaders(),
        body: JSON.stringify({ approvalId, decision, ...(value === undefined ? {} : { value }) }),
      });
      await readJson(response);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(false);
    }
  }

  const active = selectedSession?.state === 'running' || selectedSession?.state === 'waiting-approval';
  const activeProviderLabel = selectedSession === null
    ? 'No agent'
    : selectedSession.provider === 'claude-code' ? 'Claude Code' : selectedSession.provider === 'codex' ? 'Codex' : 'OMP';

  return (
    <section ref={rootRef} className="agent-chat" aria-label="Agent chat" data-workspace-id={workspaceId}>
      <header className="agent-header">
        <div>
          <span className="eyebrow">AGENT CONTROL</span>
          <h2>Agent workspace</h2>
          <div className="agent-chat-status" data-phase={chatSummary.phase} data-status={chatSummary.label}>
            <span className="agent-status-orb" aria-hidden="true" />
            <span>{chatSummary.label}</span>
            {chatSummary.usage !== null && <small>{chatSummary.usage}</small>}
          </div>
        </div>
        <div className="agent-header-actions">
          <button type="button" className="icon-button" title="Refresh agents and dynamic settings" aria-label="Refresh agents and dynamic settings" onClick={() => { void refreshSnapshot(true); if (selectedSessionId !== null) void loadSessionConfiguration(selectedSessionId); }}>↻</button>
        </div>
      </header>


      {error !== null && <div className="agent-error" role="alert">{error}</div>}

      <div ref={timelineRef} className="agent-timeline" aria-live="polite" aria-label="Agent activity" onScroll={(event) => {
        const target = event.currentTarget;
        userScrolledAwayRef.current = target.scrollHeight - target.clientHeight - target.scrollTop > 120;
      }}>
        {selectedSessionId === null && (
          <div className="agent-empty-state">
            <h3>No agent selected</h3>
            <p>Choose and configure a local agent in Settings. Its live chat and tools will appear here.</p>
            <button type="button" className="button button-primary" onClick={() => window.dispatchEvent(new CustomEvent('seevee:open-settings', { detail: 'agents' }))}>Open agent settings</button>
          </div>
        )}
        {prompts.map((prompt) => (
          <article key={prompt.id} className="agent-message is-user" data-last-timeline-item="false">
            <header>You <time>{new Date(prompt.createdAt).toLocaleTimeString()}</time></header>
            <p>{prompt.text}</p>
          </article>
        ))}
        {timeline.map((item, index) => (
          <TimelineItemView
            key={item.id}
            item={item}
            last={index === timeline.length - 1}
            busy={busy}
            onApproval={resolveApproval}
            elicitationValue={item.approvalId === null ? '' : (elicitationValues[item.approvalId] ?? '')}
            onElicitationChange={(value) => {
              if (item.approvalId === null) return;
              setElicitationValues((current) => ({ ...current, [item.approvalId as string]: value }));
            }}
          />
        ))}
      </div>

      <footer className="agent-composer-dock">
        <div className="agent-composer">
          {documentContext.enabled && (
            <button className="agent-context-chip" type="button" onClick={toggleDocumentContext} title="Remove active document context">
              <span aria-hidden="true">▣</span> {documentContext.name} <span aria-hidden="true">×</span>
            </button>
          )}
          <textarea
            value={composer}
            onChange={(event) => setComposer(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault();
                void sendPrompt();
              }
            }}
            placeholder="Work on anything…"
            rows={3}
            aria-label="Message agent"
          />
          <div className="agent-composer-toolbar">
            <button className="agent-plus-button" type="button" onClick={toggleDocumentContext} aria-label="Add active document context" aria-pressed={documentContext.enabled}>+</button>
            <span className="agent-toolbar-spacer" />
            {active && <button type="button" className="agent-stop-button" onClick={() => void interrupt()} disabled={busy}>Stop</button>}
            <div className="agent-config-selects" aria-label="Agent configuration">
              <label title="Model">
                <span className="sr-only">Model</span>
                <select value={configuration?.model ?? ''} disabled={configurationLoading || selectedSessionId === null} onChange={(event) => { if (event.target.value.length > 0) void updateConfiguration({ model: event.target.value }); }}>
                  <option value="">{configurationLoading ? 'Loading models…' : 'Provider default'}</option>
                  {configuration?.models.map((model) => <option key={model.id} value={model.id}>{model.label}</option>)}
                </select>
              </label>
              <label title="Permission mode">
                <span className="sr-only">Permission mode</span>
                <select value={configuration?.permissionMode ?? ''} disabled={configurationLoading || selectedSessionId === null} onChange={(event) => void updateConfiguration({ permissionMode: event.target.value })}>
                  <option value="">{configurationLoading ? 'Loading permissions…' : 'Permissions'}</option>
                  {configuration?.permissions.map((permission) => <option key={permission.id} value={permission.id}>{permission.label}</option>)}
                </select>
              </label>
            </div>
            <button className="agent-send-orb" type="button" onClick={() => void sendPrompt()} disabled={busy || selectedSessionId === null || composer.trim().length === 0} aria-label={active ? 'Send follow-up' : 'Run prompt'}>
              <span aria-hidden="true">↑</span>
            </button>
          </div>
        </div>
        <nav className="agent-quickbar" aria-label="Workspace shortcuts">
          <button type="button" onClick={() => window.dispatchEvent(new CustomEvent('seevee:focus-editor'))}><span aria-hidden="true">▣</span> Document</button>
          <button type="button" onClick={() => window.dispatchEvent(new CustomEvent('seevee:focus-sources'))}><span aria-hidden="true">◫</span> Sources</button>
          <button type="button" onClick={() => window.dispatchEvent(new CustomEvent('seevee:open-settings', { detail: 'agents' }))}><span aria-hidden="true">⚙</span> Agent setup</button>
          <span className="agent-quickbar-status">Right editor stays available</span>
        </nav>
      </footer>
    </section>
  );
}

interface TimelineItemViewProps {
  item: TimelineItem;
  last: boolean;
  busy: boolean;
  elicitationValue: string;
  onApproval: (approvalId: string, decision: 'allow-once' | 'allow-session' | 'deny' | 'cancel') => Promise<void>;
  onElicitationChange: (value: string) => void;
}

function TimelineItemView({ item, last, busy, elicitationValue, onApproval, onElicitationChange }: TimelineItemViewProps) {
  if (item.kind === 'assistant') {
    return (
      <article className="agent-message is-assistant" data-last-timeline-item={String(last)} data-status={item.status}>
        <header>Assistant {item.status === 'streaming' && <span className="agent-live-mark" aria-label="Streaming" />}</header>
        {item.text.length > 0 ? <MarkdownMessage text={item.text} /> : <p>{item.status === 'streaming' ? 'Working…' : ''}</p>}
      </article>
    );
  }
  if (item.kind === 'reasoning') {
    return (
      <details className="agent-reasoning" data-last-timeline-item={String(last)} data-status={item.status}>
        <summary><span>Thinking</span><small>{item.status === 'streaming' ? 'in progress' : 'summary'}</small></summary>
        <pre>{item.text || 'No reasoning details were provided.'}</pre>
      </details>
    );
  }
  if (item.kind === 'plan') {
    return (
      <article className="agent-message is-plan" data-last-timeline-item={String(last)}>
        <header>Plan</header>
        <div className="agent-plan-copy">{item.text.split('\n').map((line) => <div key={line}>{line}</div>)}</div>
      </article>
    );
  }

  if (item.kind === 'approval') {
    const pending = item.status === 'pending' && item.approvalId !== null;
    const request = item.raw as Record<string, unknown>;
    const isElicitation = typeof request['kind'] === 'string' && request['kind'].includes('elicitation');
    return (
      <article className="agent-approval" data-last-timeline-item={String(last)} data-pending-approval={String(pending)}>
        <header><span aria-hidden="true">!</span> Approval required</header>
        <h4>{item.title}</h4>
        {item.text.length > 0 && <p>{item.text}</p>}
        <details>
          <summary>Exact request</summary>
          <pre>{JSON.stringify(item.raw, null, 2)}</pre>
        </details>
        {isElicitation && pending && (
          <label className="agent-elicitation-field">
            <span>Form response JSON</span>
            <textarea value={elicitationValue} onChange={(event) => onElicitationChange(event.target.value)} rows={4} placeholder={'{"answer":"..."}'} />
          </label>
        )}
        {pending ? (
          <div className="agent-approval-actions">
            <button type="button" className="button button-primary" disabled={busy} onClick={() => item.approvalId !== null && void onApproval(item.approvalId, 'allow-once')}>Allow once</button>
            <button type="button" className="button button-subtle" disabled={busy} onClick={() => item.approvalId !== null && void onApproval(item.approvalId, 'deny')}>Deny</button>
          </div>
        ) : <p className="agent-approval-resolved">Resolved: {item.decision}</p>}
      </article>
    );
  }

  if (item.kind === 'error') {
    return (
      <article className="agent-event-card is-error" data-last-timeline-item={String(last)} data-status="failed">
        <header><span>! {item.title}</span><small>failed</small></header>
        <p>{item.text || 'The agent could not complete this run.'}</p>
        <details><summary>Technical details</summary><pre>{JSON.stringify(item.raw, null, 2)}</pre></details>
      </article>
    );
  }
  const statusLabel = item.status === 'completed' ? 'done' : item.status;
  return (
    <details className={`agent-event-card is-${item.kind}`} data-last-timeline-item={String(last)} data-status={item.status}>
      <summary className="agent-event-summary"><span>⚙ {item.title}</span><small>{statusLabel}</small></summary>
      {item.text.length > 0 && <pre className="agent-tool-output">{item.text}</pre>}
      <details className="agent-technical-details"><summary>Technical details</summary><pre>{JSON.stringify(item.raw, null, 2)}</pre></details>
    </details>
  );
}
