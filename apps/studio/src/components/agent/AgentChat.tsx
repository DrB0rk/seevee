import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { gsap } from 'gsap';
import { Check, ChevronDown, CircleAlert, Copy, FileText, FolderOpen, ListTodo, MessageCircleQuestion, Plus, RefreshCw, Search, Send, Settings2, Square, Wrench, X } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type {
  AgentEvent,
  AgentSessionConfiguration,
  AgentRuntimeSnapshot,
  AgentSessionState,
  AgentSessionSummary,
  AgentProviderId,
} from '@seevee/agent-runtime';
import { buildAnswerPayload, extractAgentQuestions, isUserQuestionRequest, type AgentQuestion } from '../../lib/agent-question.js';
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

interface ActiveDocument {
  cvId: string | null;
  presentationId: string | null;
  templateVersionId: string | null;
}

interface SavedPrompt {
  id: string;
  text: string;
  createdAt: string;
}

interface SavedSessionSummary {
  id: string;
  provider: AgentProviderId;
  externalSessionId: string;
  title: string;
  state: string;
  model: string | null;
  createdAt: string;
  lastActivityAt: string;
  /** Prompts the user sent, stored server-side with the session. */
  prompts?: SavedPrompt[];
}

function sessionTimeLabel(value: string): string {
  const elapsed = Date.now() - Date.parse(value);
  if (!Number.isFinite(elapsed) || elapsed < 60_000) return 'now';
  if (elapsed < 3_600_000) return `${Math.floor(elapsed / 60_000)}m ago`;
  if (elapsed < 86_400_000) return `${Math.floor(elapsed / 3_600_000)}h ago`;
  return new Date(value).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

interface SessionEntry {
  value: string;
  provider: AgentProviderId;
  providerLabel: string;
  title: string;
  time: string;
  running: boolean;
}

/**
 * Session identity, split rather than concatenated. A native `<select>`
 * renders one flat string, which is why long session names were being cut
 * off — the picker needs the agent, the title and the time as separate
 * elements it can size independently.
 */
function sessionEntry(input: {
  value: string;
  provider: AgentProviderId;
  title: string;
  state?: string;
  prompts?: SavedPrompt[];
  lastActivityAt?: string;
  createdAt?: string;
}): SessionEntry {
  const time = sessionTimeLabel(input.lastActivityAt ?? input.createdAt ?? new Date().toISOString());
  const providerLabel = input.provider === 'claude-code' ? 'Claude Code' : input.provider === 'codex' ? 'Codex' : 'OMP';
  const stripped = input.title.replace(/^(Codex|Claude Code|oh-my-pi|OMP)\s+session\s*$/i, '').trim();
  const first = input.prompts?.[0]?.text.replace(/\s+/g, ' ').trim() ?? '';
  // Providers hand out "Codex session" for everything, so the first thing the
  // user asked is the only useful label. Cap it: a whole pasted paragraph is
  // not a session name, and it would overflow every control that shows it.
  const fromPrompt = first.split(/(?<=[.!?])\s/)[0] ?? first;
  const raw = stripped.length > 0 ? stripped : fromPrompt;
  const title = raw.length > 0 ? raw : 'Untitled session';
  return {
    value: input.value,
    provider: input.provider,
    providerLabel,
    title,
    time,
    running: input.state === 'running' || input.state === 'waiting-approval',
  };
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
  activityCount?: number;
  activityDetail?: string | null;
  /** Failed calls collapsed into this row, kept so the error stays visible. */
  failures?: ActivityFailure[];
  /** Epoch milliseconds of the first event that produced this item. */
  at: number;
  /** Monotonic provider sequence number of that first event. */
  seq: number;
}

/**
 * Build a timeline item anchored to the event that created it. Every item
 * keeps the timestamp and sequence of its *first* event so the transcript can
 * be ordered once, globally, and never reshuffled while it streams.
 */
function timelineItem(event: AgentEvent, init: {
  id: string;
  kind: TimelineItem['kind'];
  title: string;
  status: string;
  text?: string;
  raw?: unknown;
  approvalId?: string | null;
  activityDetail?: string | null;
}): TimelineItem {
  const at = Date.parse(event.occurredAt);
  return {
    id: init.id,
    kind: init.kind,
    title: init.title,
    text: init.text ?? '',
    status: init.status,
    approvalId: init.approvalId ?? null,
    decision: null,
    raw: init.raw ?? {},
    turnId: event.turnId,
    activityDetail: init.activityDetail ?? null,
    at: Number.isFinite(at) ? at : 0,
    seq: event.seq,
  };
}

/** Short wall-clock label; a transcript spanning hours needs the time, not just a date. */
function formatClock(value: string | number): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(false), 1400);
    return () => window.clearTimeout(timer);
  }, [copied]);
  return (
    <button
      type="button"
      className="agent-copy-button"
      title="Copy to clipboard"
      aria-label="Copy to clipboard"
      onClick={() => {
        void navigator.clipboard?.writeText(text).then(() => setCopied(true)).catch(() => setCopied(false));
      }}
    >
      {copied ? <><Check size={12} aria-hidden="true" /> Copied</> : <><Copy size={12} aria-hidden="true" /> Copy</>}
    </button>
  );
}

export interface AgentChatSummary {
  phase: 'idle' | 'working' | 'waiting' | 'completed' | 'failed' | 'cancelled';
  label: string;
  usage: string | null;
  activeTools: number;
  validation: 'passed' | 'failed' | null;
  detail: string | null;
  elapsed: string | null;
}

interface AgentEventEnvelope {
  type: 'agent.event';
  event: AgentEvent;
}

interface WorkspaceEventEnvelope {
  type: string;
  [key: string]: unknown;
}

function firstLine(value: string): string {
  const line = value.replace(/\s+/g, ' ').trim();
  return line.length > 72 ? `${line.slice(0, 71)}…` : line;
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

function animateDropdownOpen(menu: HTMLElement | null, direction: 'up' | 'down'): void {
  if (menu === null || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  gsap.killTweensOf(menu);
  gsap.fromTo(menu,
    { autoAlpha: 0, y: direction === 'up' ? 5 : -5, scale: 0.985 },
    { autoAlpha: 1, y: 0, scale: 1, duration: 0.16, ease: 'power2.out', clearProps: 'transform' },
  );
}

function animateDropdownClose(menu: HTMLElement | null, direction: 'up' | 'down', onComplete: () => void): void {
  if (menu === null || window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    onComplete();
    return;
  }
  gsap.killTweensOf(menu);
  gsap.to(menu, {
    autoAlpha: 0,
    y: direction === 'up' ? 4 : -4,
    scale: 0.985,
    duration: 0.11,
    ease: 'power1.in',
    onComplete,
  });
}

function positionChatDropdown(
  anchor: HTMLElement | null,
  menu: HTMLElement | null,
  preferred: 'up' | 'down',
  contentWidth = false,
): void {
  if (anchor === null || menu === null) return;
  const anchorRect = anchor.getBoundingClientRect();
  const panelRect = anchor.closest('.agent-panel')?.getBoundingClientRect();
  const viewportPadding = 8;
  const gap = 6;
  const leftBound = Math.max(viewportPadding, panelRect?.left ?? 0);
  const rightBound = Math.min(window.innerWidth - viewportPadding, panelRect?.right ?? window.innerWidth);
  const topBound = Math.max(viewportPadding, panelRect?.top ?? 0);
  const bottomBound = Math.min(window.innerHeight - viewportPadding, panelRect?.bottom ?? window.innerHeight);

  menu.style.position = 'fixed';
  menu.style.left = '0px';
  menu.style.right = 'auto';
  menu.style.top = '0px';
  menu.style.bottom = 'auto';
  menu.style.width = preferred === 'down' && !contentWidth ? `${Math.max(160, anchorRect.width)}px` : 'max-content';
  const availableWidth = Math.max(120, rightBound - leftBound - viewportPadding * 2);
  const preferredWidth = contentWidth ? 240 : preferred === 'up' ? 280 : anchorRect.width;
  menu.style.maxWidth = `${Math.min(preferredWidth, availableWidth)}px`;
  menu.style.maxHeight = `${Math.max(100, Math.min(260, bottomBound - topBound - viewportPadding * 2))}px`;

  const menuRect = menu.getBoundingClientRect();
  // A transformed ancestor can establish the containing block for `fixed`.
  // Measure its origin so the final coordinates remain viewport-relative.
  menu.style.left = '0px';
  menu.style.top = '0px';
  const originRect = menu.getBoundingClientRect();
  const width = Math.min(menuRect.width, rightBound - leftBound - viewportPadding * 2);
  const height = Math.min(menu.scrollHeight, menuRect.height, bottomBound - topBound - viewportPadding * 2);
  const left = Math.max(leftBound + viewportPadding, Math.min(anchorRect.left, rightBound - width - viewportPadding));
  const spaceBelow = bottomBound - anchorRect.bottom - gap - viewportPadding;
  const spaceAbove = anchorRect.top - topBound - gap - viewportPadding;
  const placeAbove = preferred === 'up' ? spaceAbove >= Math.min(height, 120) || spaceAbove >= spaceBelow : spaceBelow < Math.min(height, 160) && spaceAbove > spaceBelow;
  const top = placeAbove ? anchorRect.top - gap - height : anchorRect.bottom + gap;

  const boundedTop = Math.max(topBound + viewportPadding, Math.min(top, bottomBound - height - viewportPadding));
  menu.style.left = `${Math.round(left - originRect.left)}px`;
  menu.style.top = `${Math.round(boundedTop - originRect.top)}px`;
  menu.style.width = `${Math.round(width)}px`;
  menu.dataset['placement'] = placeAbove ? 'top' : 'bottom';
}

type ActivityCategory = 'command' | 'file' | 'edit' | 'search' | 'tool';

function activityCategory(title: string, raw: unknown): ActivityCategory {
  const name = title.toLowerCase();
  const data = typeof raw === 'object' && raw !== null ? raw as Record<string, unknown> : {};
  const kind = typeof data['kind'] === 'string' ? data['kind'].toLowerCase() : '';
  if (kind === 'execute' || name.includes('command') || name.includes('shell') || name.includes('bash')) return 'command';
  if (kind === 'edit' || name.includes('edit') || name.includes('write') || name.includes('patch')) return 'edit';
  if (name.includes('read') || name.includes('view') || name.includes('open') || name.includes('cat')) return 'file';
  if (name.includes('search') || name.includes('list') || name.includes('glob') || name.includes('grep')) return 'search';
  return 'tool';
}

function activityNoun(category: ActivityCategory, count: number): string {
  if (category === 'command') return count === 1 ? 'command' : 'commands';
  if (category === 'file') return count === 1 ? 'file' : 'files';
  if (category === 'edit') return count === 1 ? 'file' : 'files';
  if (category === 'search') return 'the workspace';
  return count === 1 ? 'tool' : 'tools';
}

function activityLabel(category: ActivityCategory, count: number, running: boolean): string {
  if (category === 'command') return running ? `Running ${count === 1 ? 'a command' : `${count} commands`}` : `Ran ${count} ${activityNoun(category, count)}`;
  if (category === 'file') return running ? `Reading ${count === 1 ? 'a file' : `${count} files`}` : `Read ${count} ${activityNoun(category, count)}`;
  if (category === 'edit') return running ? `Updating ${count === 1 ? 'a file' : `${count} files`}` : `Updated ${count} ${activityNoun(category, count)}`;
  if (category === 'search') return running ? 'Searching the workspace' : 'Searched the workspace';
  return running ? `Using ${count === 1 ? 'a tool' : `${count} tools`}` : `Used ${count} ${activityNoun(category, count)}`;
}

function activityFailureLabel(category: ActivityCategory): string {
  if (category === 'command') return 'Command failed';
  if (category === 'file') return 'Could not read file';
  if (category === 'edit') return 'Could not update file';
  if (category === 'search') return 'Workspace search failed';
  return 'Tool failed';
}


/**
 * The status line reports what kind of work is happening, never the raw
 * arguments. A shell command three lines long tells the reader nothing that
 * "running a command" does not, and the exact command is one click away in
 * the collapsed row.
 */
function toolStatusDetail(toolName: string, data: Record<string, unknown>, running: boolean): string {
  if (toolName.includes('.')) return toolName;
  switch (activityCategory(toolName, data)) {
    case 'command': return running ? 'running a shell command' : 'a shell command failed';
    case 'edit': return running ? 'updating a file' : 'a file update failed';
    case 'file': return running ? 'reading a file' : 'a file could not be read';
    case 'search': return running ? 'searching the workspace' : 'the workspace search failed';
    default: return running ? 'using a tool' : 'a tool call failed';
  }
}
function activityDetail(raw: unknown): string | null {
  const data = typeof raw === 'object' && raw !== null ? raw as Record<string, unknown> : {};
  const input = data['input'] ?? data['command'] ?? data['path'] ?? data['filePath'] ?? data['query'] ?? data['pattern'] ?? data['title'] ?? data['description'];
  const values = typeof input === 'string' ? [input] : typeof input === 'object' && input !== null
    ? Object.values(input as Record<string, unknown>).filter((value): value is string => typeof value === 'string')
    : [];
  const detail = values.map((value) => value.replace(/\s+/g, ' ').trim()).find((value) => value.length > 0);
  if (detail === undefined) return null;
  return detail.length > 96 ? `${detail.slice(0, 93)}…` : detail;
}

function formatDuration(milliseconds: number): string {
  const seconds = Math.max(0, Math.floor(milliseconds / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  return `${minutes}m ${seconds % 60}s`;
}

function runningActivityLabel(toolNames: Iterable<string>): string {
  const counts = new Map<ActivityCategory, number>();
  for (const name of toolNames) {
    const category = activityCategory(name, {});
    counts.set(category, (counts.get(category) ?? 0) + 1);
  }
  const entries = [...counts.entries()];
  if (entries.length === 0) return 'Working';
  if (entries.length === 1) {
    const [category, count] = entries[0]!;
    return activityLabel(category, count, true);
  }
  const total = entries.reduce((sum, [, count]) => sum + count, 0);
  return `Running ${total} tools`;
}

/** Statuses that a provider reports while a call is still executing. */
function isRunningStatus(status: string): boolean {
  return ['running', 'pending', 'inprogress', 'in_progress', 'in-progress'].includes(status.toLowerCase());
}

function isFailureStatus(status: string): boolean {
  return ['failed', 'declined', 'cancelled', 'canceled', 'error'].includes(status.toLowerCase());
}

function normalizeToolStatus(status: unknown, fallback: string): string {
  if (typeof status !== 'string') return fallback;
  const normalized = status.toLowerCase().replace(/[_\s]/g, '-');
  if (['running', 'pending', 'in-progress', 'inprogress'].includes(normalized)) return 'running';
  if (['completed', 'complete', 'done', 'success', 'succeeded'].includes(normalized)) return 'completed';
  if (['failed', 'error', 'declined'].includes(normalized)) return 'failed';
  if (['cancelled', 'canceled', 'interrupted'].includes(normalized)) return 'cancelled';
  return normalized;
}

function toolStatusRank(status: string): number {
  if (isFailureStatus(status)) return 2;
  if (isRunningStatus(status)) return 0;
  return 1;
}

interface ActivityFailure {
  input: string | null;
  output: string;
}

/**
 * Read reasoning text from either provider shape: a plain `delta` string, or
 * the structured content blocks ACP providers send. Codex streams the block
 * array but leaves it empty, so a reasoning row can be produced with no
 * content behind it at all.
 */
function reasoningDelta(data: Record<string, unknown>): string {
  const delta = data['delta'];
  if (typeof delta === 'string') return delta;
  const text = data['text'];
  if (typeof text === 'string') return text;
  if (!Array.isArray(text)) return '';
  return text.flatMap((block) => {
    if (typeof block === 'string') return [block];
    if (block !== null && typeof block === 'object' && 'text' in block && typeof block.text === 'string') return [block.text];
    return [];
  }).join('');
}

/**
 * Collapse consecutive tool calls of the same kind into one row.
 *
 * A row is only useful if it tells you what happened. Collapsing 28 shell
 * calls into "Ran 28 commands" hides the three that blew up, so every
 * failure inside a group is kept and shown on its own — a failure you cannot
 * see is the same as no failure reporting at all.
 */
function compactToolActivity(items: TimelineItem[]): TimelineItem[] {
  const output: TimelineItem[] = [];
  const groups = new Map<string, TimelineItem>();
  for (const item of items) {
    if (item.kind !== 'tool') {
      if (item.kind === 'assistant' || item.kind === 'plan' || item.kind === 'approval' || item.kind === 'error') groups.clear();
      output.push(item);
      continue;
    }
    const category = activityCategory(item.title, item.raw);
    const key = `${item.turnId ?? 'none'}:${category}`;
    const existing = groups.get(key);
    if (existing === undefined) {
      const group: TimelineItem = {
        ...item,
        title: groupTitle(category, 1, item.status, isFailureStatus(item.status) ? 1 : 0),
        raw: { calls: [item.raw] },
        activityDetail: item.activityDetail ?? null,
        failures: isFailureStatus(item.status) && item.text.length > 0
          ? [{ input: item.activityDetail ?? null, output: item.text }]
          : [],
      };
      groups.set(key, group);
      output.push(group);
      continue;
    }
    const count = (existing.activityCount ?? 1) + 1;
    existing.activityCount = count;
    if (toolStatusRank(item.status) > toolStatusRank(existing.status)) existing.status = item.status;
    existing.failures = [
      ...(existing.failures ?? []),
      ...(isFailureStatus(item.status) && item.text.length > 0
        ? [{ input: item.activityDetail ?? null, output: item.text }]
        : []),
    ];
    existing.title = groupTitle(category, count, existing.status, existing.failures.length);
    if (item.text.length > 0 && !isFailureStatus(item.status)) existing.text = item.text;
    if (item.activityDetail !== null && item.activityDetail !== undefined) existing.activityDetail = item.activityDetail;
    const existingRaw = typeof existing.raw === 'object' && existing.raw !== null ? existing.raw as { calls?: unknown[] } : {};
    existing.raw = { calls: [...(existingRaw.calls ?? []), item.raw] };
  }
  return output;
}

function groupTitle(category: ActivityCategory, count: number, status: string, failures: number): string {
  const label = activityLabel(category, count, isRunningStatus(status));
  if (failures === 0) return label;
  return `${label} · ${failures} failed`;
}

export function summarizeAgentEvents(events: AgentEvent[], sessionState: AgentSessionState, now = Date.now()): AgentChatSummary {
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
  let turnStartedAt: number | null = null;
  let elapsed: string | null = null;
  let detail: string | null = null;
  const tools = new Map<string, string>();
  const toolDetails = new Map<string, string | null>();
  let failedTools = 0;

  for (const event of events) {
    const data = event.data as Record<string, unknown>;
    if (event.type === 'usage.updated') usage = formatUsage(data);
    if (event.type === 'turn.started') {
      currentTurnId = event.turnId;
      currentIssue = null;
      turnStartedAt = Number.isNaN(Date.parse(event.occurredAt)) ? now : Date.parse(event.occurredAt);
      elapsed = null;
      phase = 'working';
      label = 'Thinking';
      detail = 'Preparing the next step…';
    }
    if (event.type === 'turn.queued') {
      phase = 'working';
      label = 'Queued';
      detail = 'Waiting for the current step to finish…';
    }
    if (event.type === 'message.started') {
      phase = 'working';
      label = 'Thinking';
      detail ??= 'Composing the next response…';
    }
    if (event.type === 'approval.requested') {
      phase = 'waiting';
      label = 'Approval needed';
      detail = 'Waiting for your decision before continuing.';
    }
    if (event.type === 'approval.resolved') {
      const decision = typeof data['decision'] === 'string' ? data['decision'] : '';
      if (decision === 'deny' || decision === 'cancel') {
        currentIssue = { turnId: currentTurnId, label: 'Approval denied' };
        phase = 'failed';
        label = currentIssue.label;
        detail = 'The agent cannot continue without approval.';
      } else if (currentIssue === null) {
        phase = 'working';
        label = 'Continuing';
        detail = 'Continuing after your approval…';
      }
    }
    if (event.type === 'tool.started' || event.type === 'tool.updated' || event.type === 'tool.completed') {
      const callId = typeof data['callId'] === 'string' ? data['callId'] : event.turnId ?? `${event.seq}`;
      const toolName = typeof data['name'] === 'string' ? data['name'] : 'tool';
    const status = normalizeToolStatus(data['status'], event.type === 'tool.completed' ? 'completed' : 'running');
      const toolCategory = activityCategory(toolName, data);
      if (event.type === 'tool.completed') {
        tools.delete(callId);
        toolDetails.delete(callId);
        if (isFailureStatus(status) || data['error'] !== undefined) {
          failedTools += 1;
          currentIssue = { turnId: currentTurnId, label: activityFailureLabel(toolCategory) };
          // A failed command does not stop the agent. Marking the phase
          // "failed" here made the panel claim the run was over while it was
          // still working; the turn decides when a failure is terminal.
        }
      } else {
        tools.set(callId, toolName);
        toolDetails.set(callId, activityDetail(data));
        phase = 'working';
        label = runningActivityLabel(tools.values());
        detail = toolStatusDetail(toolName, data, true);
      }
    }
    if (event.type === 'validation.started' && currentIssue === null && phase !== 'completed') {
      phase = 'working';
      label = 'Validating workspace';
      detail = 'Checking the workspace for consistency…';
    }
    if (event.type === 'validation.completed') {
      validation = data['status'] === 'passed' ? 'passed' : 'failed';
      if (validation === 'failed' && currentIssue === null) {
        phase = 'failed';
        label = 'Validation needs attention';
        detail = 'Some workspace checks need attention.';
      } else if (validation === 'passed' && currentIssue === null) {
        if (phase === 'completed') {
          label = 'Completed · workspace valid';
          detail = 'Workspace changes are valid.';
        } else {
          detail = 'Workspace checks passed.';
        }
      }
    }
    if (event.type === 'turn.completed') {
      if (turnStartedAt !== null) elapsed = formatDuration(now - turnStartedAt);
      tools.clear();
      toolDetails.clear();
      if (currentIssue !== null && (currentIssue.turnId === null || currentIssue.turnId === event.turnId)) {
        phase = 'failed';
        label = currentIssue.label;
      } else {
        phase = 'completed';
        label = validation === 'passed' ? 'Completed · workspace valid' : 'Completed';
        detail = validation === 'passed' ? 'Workspace changes are valid.' : 'The run finished successfully.';
      }
    }
    if (event.type === 'turn.failed' || event.type === 'error') {
      phase = 'failed';
      label = currentIssue?.label ?? 'Needs attention';
      detail = typeof data['message'] === 'string' ? data['message'] : detail ?? 'Review the activity above.';
    }
    if (event.type === 'turn.cancelled') {
      if (turnStartedAt !== null) elapsed = formatDuration(now - turnStartedAt);
      phase = 'cancelled';
      label = 'Stopped';
      detail = 'The run was stopped.';
      tools.clear();
      toolDetails.clear();
    }
  }

  if (phase === 'working' && tools.size > 0) {
    label = runningActivityLabel(tools.values());
  }
  if (elapsed === null && phase === 'working' && turnStartedAt !== null) elapsed = formatDuration(now - turnStartedAt);
  // The status line sits under the whole visible transcript, so it has to
  // agree with the rows above it. The phase label already names what failed;
  // the detail carries the counts and the next action, and nothing else.
  if (failedTools > 0) {
    const failed = `${failedTools} tool call${failedTools === 1 ? '' : 's'} failed`;
    const checks = validation === 'failed' ? ' · validation needs attention' : '';
    detail = `${failed}${checks} — open the activity to see why`;
  } else {
    if (detail === null && phase === 'working') detail = 'Thinking…';
    if (detail === null && phase === 'waiting') detail = 'Waiting for your decision.';
    if (detail === null && phase === 'failed') detail = 'Review the activity above.';
  }
  return { phase, label, usage, activeTools: tools.size, validation, detail, elapsed };
}

function formatPlan(data: Record<string, unknown>): string {
  return normalizePlanSteps(data).map((entry) => `${entry.content} — ${entry.status}`).join('\n');
}

type PlanStepStatus = 'pending' | 'in-progress' | 'completed';
interface AgentPlanStep {
  id: string;
  content: string;
  status: PlanStepStatus;
}

function normalizePlanStatus(value: unknown): PlanStepStatus {
  if (typeof value !== 'string') return 'pending';
  const status = value.toLowerCase().replace(/[_\s]/g, '-');
  if (status === 'completed' || status === 'complete' || status === 'done') return 'completed';
  if (status === 'inprogress' || status === 'in-progress' || status === 'active' || status === 'running') return 'in-progress';
  return 'pending';
}

function normalizePlanSteps(data: Record<string, unknown>): AgentPlanStep[] {
  const input = typeof data['input'] === 'object' && data['input'] !== null ? data['input'] as Record<string, unknown> : {};
  const source = data['entries'] ?? data['plan'] ?? data['todos'] ?? data['items'] ?? input['todos'];
  if (Array.isArray(source)) {
    return source.flatMap((entry, index) => {
      if (typeof entry === 'string') {
        const content = entry.replace(/^\s*[-*]\s+\[[ xX]\]\s*/, '').trim();
        if (content.length === 0) return [];
        const checked = /^\s*[-*]\s+\[[xX]\]/.test(entry);
        return [{ id: `step-${index}`, content, status: checked ? 'completed' as const : 'pending' as const }];
      }
      if (typeof entry !== 'object' || entry === null) return [];
      const record = entry as Record<string, unknown>;
      const content = ['content', 'step', 'text', 'title', 'description', 'activeForm']
        .map((key) => record[key])
        .find((value): value is string => typeof value === 'string' && value.trim().length > 0)?.trim();
      if (content === undefined) return [];
      const id = typeof record['id'] === 'string' && record['id'].length > 0 ? record['id'] : `step-${index}`;
      return [{ id, content, status: normalizePlanStatus(record['status']) }];
    });
  }
  const text = typeof data['text'] === 'string' ? data['text'].trim() : '';
  if (text.length === 0 || text === 'Plan updated.') return [];
  return text.split('\n').map((line, index) => line.trim()).filter(Boolean).map((content, index) => ({
    id: `step-${index}`,
    content: content.replace(/^\s*[-*]\s+\[[ xX]\]\s*/, ''),
    status: /^\s*[-*]\s+\[[xX]\]/.test(text.split('\n')[index] ?? '') ? 'completed' : 'pending',
  }));
}

function MarkdownMessage({ text }: { text: string }) {
  return (
    <div className="agent-markdown">
      <ReactMarkdown remarkPlugins={[remarkGfm]} skipHtml>{text}</ReactMarkdown>
    </div>
  );
}

function PlanDock({ item }: { item: TimelineItem }) {
  const [collapsed, setCollapsed] = useState(false);
  const stepsRef = useRef<HTMLOListElement>(null);
  const raw = typeof item.raw === 'object' && item.raw !== null ? item.raw as Record<string, unknown> : {};
  const steps = normalizePlanSteps(raw);
  if (steps.length === 0) return null;
  const completed = steps.filter((step) => step.status === 'completed').length;
  const active = steps.find((step) => step.status === 'in-progress');
  const progress = Math.round((completed / steps.length) * 100);
  const summary = active?.content ?? (completed === steps.length ? 'All steps complete' : `${completed} of ${steps.length} complete`);

  const toggle = () => {
    const list = stepsRef.current;
    if (list === null || window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setCollapsed((value) => !value);
      return;
    }
    if (collapsed) {
      setCollapsed(false);
      requestAnimationFrame(() => {
        if (stepsRef.current === null) return;
        gsap.fromTo(stepsRef.current, { height: 0, autoAlpha: 0 }, { height: 'auto', autoAlpha: 1, duration: 0.2, ease: 'power2.out', clearProps: 'height' });
      });
      return;
    }
    gsap.to(list, { height: 0, autoAlpha: 0, duration: 0.14, ease: 'power1.in', onComplete: () => setCollapsed(true) });
  };

  return (
    <section className="agent-plan-dock" aria-label="Agent plan">
      <button
        type="button"
        className="agent-plan-toggle"
        aria-expanded={!collapsed}
        onClick={toggle}
      >
        <ListTodo size={16} aria-hidden="true" />
        <span className="agent-plan-heading">
          <strong>Plan</strong>
          <span title={summary}>{summary}</span>
        </span>
        <span className="agent-plan-count">{completed}/{steps.length}</span>
        <ChevronDown className="agent-plan-caret" size={14} aria-hidden="true" />
      </button>
      <div className="agent-plan-progress" role="progressbar" aria-label="Plan progress" aria-valuemin={0} aria-valuemax={steps.length} aria-valuenow={completed}>
        <span style={{ width: `${progress}%` }} />
      </div>
      {!collapsed && (
        <ol className="agent-plan-steps" ref={stepsRef}>
          {steps.map((step) => (
            <li key={step.id} data-status={step.status}>
              <span className="agent-plan-step-icon" aria-hidden="true">
                {step.status === 'completed' ? <Check size={12} strokeWidth={2.5} /> : <span />}
              </span>
              <span>{step.content}</span>
              <small>{step.status === 'completed' ? 'Done' : step.status === 'in-progress' ? 'In progress' : 'Next'}</small>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

export function buildTimeline(events: AgentEvent[]): TimelineItem[] {
  const items: TimelineItem[] = [];
  const tools = new Map<string, TimelineItem>();
  const todoCalls = new Set<string>();
  const approvals = new Map<string, TimelineItem>();
  let assistant: TimelineItem | null = null;
  let reasoning: TimelineItem | null = null;
  let plan: TimelineItem | null = null;

  const updatePlan = (event: AgentEvent, data: Record<string, unknown>) => {
    if (plan === null) {
      plan = timelineItem(event, {
        id: `plan-${event.turnId ?? event.seq}`,
        kind: 'plan',
        title: 'Plan',
        status: 'active',
        raw: data,
      });
      items.push(plan);
    }
    plan.raw = data;
    plan.text = formatPlan(data);
  };
  const finishAssistant = (status: 'completed' | 'cancelled' | 'failed' = 'completed') => {
    if (assistant !== null && assistant.status === 'streaming') assistant.status = status;
    assistant = null;
  };
  const finishReasoning = (status: 'completed' | 'cancelled' | 'failed' = 'completed') => {
    if (reasoning !== null && reasoning.status === 'streaming') reasoning.status = status;
    reasoning = null;
  };

  for (const event of events) {
    const data = event.data as Record<string, unknown>;
    switch (event.type) {
      case 'message.started':
        // OMP mirrors the user's own message on its provider stream. Seevee
        // already renders the saved prompt, so only assistant messages enter
        // the shared transcript.
        if (data['role'] === 'user') break;
        finishAssistant();
        finishReasoning();
        assistant = timelineItem(event, {
          id: `assistant-${event.seq}`,
          kind: 'assistant',
          title: 'Assistant',
          text: typeof data['text'] === 'string' ? data['text'] : '',
          status: 'streaming',
          raw: data,
        });
        reasoning = null;
        items.push(assistant);
        break;
      case 'message.delta':
        finishReasoning();
        if (assistant === null) {
          assistant = timelineItem(event, {
            id: `assistant-${event.seq}`,
            kind: 'assistant',
            title: 'Assistant',
            status: 'streaming',
          });
          items.push(assistant);
        }
        assistant.text += typeof data['delta'] === 'string' ? data['delta'] : '';
        break;
      case 'message.completed':
        if (assistant !== null && assistant.text.length === 0 && typeof data['text'] === 'string') assistant.text = data['text'];
        finishAssistant();
        finishReasoning();
        break;
      case 'reasoning.delta': {
        if (reasoning === null) {
          reasoning = timelineItem(event, {
            id: `reasoning-${event.seq}`,
            kind: 'reasoning',
            title: 'Thinking',
            status: 'streaming',
          });
          items.push(reasoning);
        }
        reasoning.text += reasoningDelta(data);
        break;
      }
      case 'plan.updated':
        finishAssistant();
        finishReasoning();
        updatePlan(event, data);
        break;
      case 'tool.started':
      case 'tool.updated':
      case 'tool.completed': {
        finishAssistant();
        finishReasoning();
        const callId = typeof data['callId'] === 'string' ? data['callId'] : `tool-${event.seq}`;
        const toolName = typeof data['name'] === 'string' ? data['name'] : '';
        if (toolName.toLowerCase() === 'todowrite') {
          todoCalls.add(callId);
          const todoInput = typeof data['input'] === 'object' && data['input'] !== null ? data['input'] as Record<string, unknown> : {};
          if (Array.isArray(todoInput['todos'])) updatePlan(event, { entries: todoInput['todos'] });
          if (event.type === 'tool.completed') todoCalls.delete(callId);
          break;
        }
        if (todoCalls.has(callId)) {
          if (event.type === 'tool.completed') todoCalls.delete(callId);
          break;
        }
        let item = tools.get(callId);
        if (item === undefined) {
          const fallbackStatus = event.type === 'tool.completed' ? 'completed' : 'running';
          item = timelineItem(event, {
            id: `tool-${callId}`,
            kind: 'tool',
            title: typeof data['name'] === 'string' ? data['name'] : 'Tool call',
            status: normalizeToolStatus(data['status'], fallbackStatus),
            raw: data,
            activityDetail: activityDetail(data),
          });
          tools.set(callId, item);
          items.push(item);
        }
        item.status = normalizeToolStatus(data['status'], event.type === 'tool.completed' ? 'completed' : 'running');
        if (typeof data['delta'] === 'string') item.text += data['delta'];
        if (typeof data['output'] === 'string') item.text = data['output'];
        item.raw = { ...(item.raw as Record<string, unknown>), ...data };
        item.activityDetail = activityDetail(item.raw) ?? item.activityDetail ?? null;
        break;
      }
      case 'approval.requested': {
        finishAssistant();
        finishReasoning();
        const approvalId = event.approvalId ?? `approval-${event.seq}`;
        const item: TimelineItem = timelineItem(event, {
          id: `approval-${approvalId}`,
          kind: 'approval',
          title: typeof data['title'] === 'string' ? data['title'] : 'Agent approval required',
          text: typeof data['description'] === 'string' ? data['description'] : '',
          status: 'pending',
          approvalId,
          raw: data,
        });
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
          if (item.status === 'streaming' || isRunningStatus(item.status)) item.status = 'completed';
        }
        finishAssistant();
        finishReasoning();
        break;
      case 'turn.cancelled':
        for (const item of items) {
          if (item.status === 'streaming' || isRunningStatus(item.status)) item.status = 'cancelled';
        }
        finishAssistant('cancelled');
        finishReasoning('cancelled');
        break;
      case 'usage.updated':
      case 'turn.queued':
      case 'workspace.changed':
      case 'validation.started':
      case 'subactivity.updated':
      case 'session.state':
        break;
      case 'turn.started':
        // Treat a new turn as the end of any orphaned streaming rows from a
        // previous turn, even when a provider omitted turn.completed.
        for (const item of items) {
          if (item.status === 'streaming' || isRunningStatus(item.status)) item.status = 'completed';
        }
        finishAssistant();
        finishReasoning();
        plan = null;
        break;
      case 'turn.failed':
      case 'validation.completed':
        if (event.type === 'validation.completed' && data['status'] !== 'failed') break;
        if (event.type === 'turn.failed') {
          for (const item of items) {
            if (item.status === 'streaming' || isRunningStatus(item.status)) item.status = 'failed';
          }
          finishAssistant('failed');
          finishReasoning('failed');
        }
        items.push(timelineItem(event, {
          id: `error-${event.seq}`,
          kind: 'error',
          title: event.type === 'validation.completed' ? 'Workspace validation needs attention' : 'Agent run needs attention',
          text: typeof data['message'] === 'string'
            ? data['message']
            : event.type === 'validation.completed'
              ? `${String(data['failures'] instanceof Array ? data['failures'].length : 0)} validation checks failed.`
              : 'The agent could not complete this run.',
          status: 'failed',
          raw: data,
        }));
        break;
      case 'error':
        for (const item of items) {
          if (item.status === 'streaming' || isRunningStatus(item.status)) item.status = 'failed';
        }
        finishAssistant('failed');
        finishReasoning('failed');
        items.push(timelineItem(event, {
          id: `error-${event.seq}`,
          kind: 'error',
          title: 'Agent error',
          text: typeof data['message'] === 'string' ? data['message'] : 'Unknown agent error.',
          status: 'failed',
          raw: data,
        }));
        break;
      default:
        break;
    }
  }
  // Items stay in the exact order the provider emitted them. Reordering a
  // finished message after later tool activity made the transcript jump
  // while it streamed, which reads as the agent losing its place.
  return compactToolActivity(items);
}

export type ChatStreamEntry =
  | { key: string; kind: 'prompt'; at: number; prompt: LocalPrompt }
  | { key: string; kind: 'item'; at: number; item: TimelineItem };

/**
 * Merge user prompts and agent activity into one strictly ordered stream.
 *
 * Ordering is by wall-clock time of the first event, with the provider
 * sequence number as tiebreak for agent activity. A prompt always sorts
 * before agent activity at the same millisecond, because the run it
 * triggers is causally later. `Array.prototype.sort` is stable, so entries
 * that tie on every key keep their insertion order.
 */
export function buildChatStream(items: TimelineItem[], prompts: LocalPrompt[]): ChatStreamEntry[] {
  const entries: ChatStreamEntry[] = [
    ...items.filter((item) => item.kind !== 'plan').map((item) => ({ key: `item:${item.id}`, kind: 'item' as const, at: item.at, item })),
    ...prompts.map((prompt) => ({ key: `prompt:${prompt.id}`, kind: 'prompt' as const, at: Date.parse(prompt.createdAt), prompt })),
  ];
  for (const entry of entries) {
    if (Number.isFinite(entry.at)) continue;
    entry.at = entry.kind === 'item' ? entry.item.seq : Number.MAX_SAFE_INTEGER;
  }
  return entries.sort((left, right) => {
    if (left.at !== right.at) return left.at - right.at;
    if (left.kind !== right.kind) return left.kind === 'prompt' ? -1 : 1;
    if (left.kind === 'item' && right.kind === 'item' && left.item.seq !== right.item.seq) return left.item.seq - right.item.seq;
    return 0;
  });
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
  const [activeDocument, setActiveDocument] = useState<ActiveDocument | null>(null);
  const [documentContextOn, setDocumentContextOn] = useState(true);
  const [busy, setBusy] = useState(false);
  const [interrupting, setInterrupting] = useState(false);
  const [eventStreamConnected, setEventStreamConnected] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pendingPrompts, setPendingPrompts] = useState<Record<string, SavedPrompt[]>>({});
  const [elicitationValues, setElicitationValues] = useState<Record<string, string>>({});
  const [questionAnswers, setQuestionAnswers] = useState<Record<string, string>>({});
  const userScrolledAwayRef = useRef(false);
  const initializedScrollSessionRef = useRef<string | null>(null);
  const [clockNow, setClockNow] = useState(() => Date.now());
  const [providers, setProviders] = useState<AgentRuntimeSnapshot['providers']>([]);
  const [savedSessions, setSavedSessions] = useState<SavedSessionSummary[]>([]);
  const [sessionActionBusy, setSessionActionBusy] = useState(false);
  const preferredSessionIdRef = useRef<string | null>(null);

  const selectedSession = sessions.find((session) => session.id === selectedSessionId) ?? null;
  const selectedEvents = useMemo(
    () => events.filter((event) => event.sessionId === selectedSessionId),
    [events, selectedSessionId],
  );
  const timeline = useMemo(() => buildTimeline(selectedEvents), [selectedEvents]);
  const currentPlan = useMemo(() => {
    for (let index = timeline.length - 1; index >= 0; index -= 1) {
      const item = timeline[index];
      if (item?.kind === 'plan' && typeof item.raw === 'object' && item.raw !== null && normalizePlanSteps(item.raw as Record<string, unknown>).length > 0) return item;
    }
    return null;
  }, [timeline]);
  const prompts = useMemo<LocalPrompt[]>(() => {
    // The provider's event stream only reports what the agent said, so the
    // user's half of the conversation comes from the session record. Prompts
    // echoed locally fill the gap between sending and the next snapshot.
    const externalSessionId = selectedSession?.externalSessionId
      ?? savedSessions.find((item) => item.id === selectedSessionId)?.externalSessionId
      ?? null;
    if (externalSessionId === null) return [];
    const stored = savedSessions.find((item) => item.externalSessionId === externalSessionId)?.prompts ?? [];
    const echoed = pendingPrompts[externalSessionId] ?? [];
    const byId = new Map<string, LocalPrompt>();
    for (const prompt of [...stored, ...echoed]) {
      const visibleText = prompt.text.replace(/^Work on the active document \(cv [^)]+\)\.\n\n/, '');
      byId.set(prompt.id, { id: prompt.id, sessionId: externalSessionId, text: visibleText, createdAt: prompt.createdAt });
    }
    return [...byId.values()].sort((left, right) => Date.parse(left.createdAt) - Date.parse(right.createdAt));
  }, [savedSessions, selectedSession, selectedSessionId, pendingPrompts]);
  const stream = useMemo(() => buildChatStream(timeline, prompts), [timeline, prompts]);
  useEffect(() => {
    const running = selectedSession?.state === 'running' || selectedSession?.state === 'waiting-approval';
    if (!running) return;
    setClockNow(Date.now());
    const timer = window.setInterval(() => setClockNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [selectedSession?.state]);
  const chatSummary = useMemo(
    () => summarizeAgentEvents(selectedEvents, selectedSession?.state ?? 'idle', clockNow),
    [selectedEvents, selectedSession?.state, clockNow],
  );

  const refreshSnapshot = useCallback(async (refreshProviders = false) => {
    const response = await fetch(`/api/agents${refreshProviders ? '?refresh=1' : ''}`, { cache: 'no-store' });
    const payload = await readJson<{ snapshot: AgentRuntimeSnapshot; savedSessions: SavedSessionSummary[]; activeDocument?: ActiveDocument }>(response);
    if (payload.activeDocument !== undefined) setActiveDocument(payload.activeDocument);
    setProviders(payload.snapshot.providers);
    setSavedSessions(payload.savedSessions);
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
    const preferredSessionId = preferredSessionIdRef.current ?? storedSessionId;
    const selected = payload.snapshot.sessions.find((session) => session.id === preferredSessionId)
      ?? payload.snapshot.sessions.at(-1);
    preferredSessionIdRef.current = selected?.id ?? null;
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

  const selectLiveSession = useCallback((sessionId: string) => {
    preferredSessionIdRef.current = sessionId;
    setSelectedSessionId(sessionId);
    try {
      localStorage.setItem(ACTIVE_AGENT_SESSION_KEY, sessionId);
    } catch {
      // The current page still receives the selected session.
    }
  }, []);

  const createSession = useCallback(async (provider: AgentProviderId, resumeSessionId?: string): Promise<void> => {
    setSessionActionBusy(true);
    setError(null);
    try {
      const response = await fetch('/api/agents/session', {
        method: 'POST',
        headers: jsonHeaders(),
        body: JSON.stringify(resumeSessionId === undefined ? { provider } : { provider, resumeSessionId }),
      });
      const payload = await readJson<{ session: AgentSessionSummary }>(response);
      setSessions((current) => [...current.filter((item) => item.id !== payload.session.id), payload.session]);
      selectLiveSession(payload.session.id);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setSessionActionBusy(false);
    }
  }, [selectLiveSession]);

  const startNewSession = useCallback(async () => {
    const provider = selectedSession?.provider ?? providers.find((item) => item.ready)?.id;
    if (provider === undefined) {
      setError('No ready agent provider is available. Open Agent setup first.');
      return;
    }
    await createSession(provider);
  }, [createSession, providers, selectedSession?.provider]);

  const selectProvider = useCallback(async (providerId: AgentProviderId) => {
    const provider = providers.find((item) => item.id === providerId);
    if (provider === undefined || !provider.ready) {
      setError(`${provider?.label ?? providerId} is not ready. Check Agent setup and try again.`);
      return;
    }
    const live = sessions
      .filter((session) => session.provider === providerId)
      .sort((left, right) => Date.parse(right.lastActivityAt) - Date.parse(left.lastActivityAt))[0];
    if (live !== undefined) {
      selectLiveSession(live.id);
      return;
    }
    const saved = savedSessions
      .filter((session) => session.provider === providerId)
      .sort((left, right) => Date.parse(right.lastActivityAt) - Date.parse(left.lastActivityAt))[0];
    if (saved !== undefined) {
      await createSession(providerId, saved.externalSessionId);
      return;
    }
    await createSession(providerId);
  }, [createSession, providers, savedSessions, selectLiveSession, sessions]);

  const selectSessionOption = useCallback(async (value: string) => {
    if (value.startsWith('live:')) {
      selectLiveSession(value.slice('live:'.length));
      return;
    }
    const saved = savedSessions.find((item) => `saved:${item.externalSessionId}` === value);
    if (saved === undefined) return;
    const live = sessions.find((item) => item.externalSessionId === saved.externalSessionId);
    if (live !== undefined) {
      selectLiveSession(live.id);
      return;
    }
    await createSession(saved.provider, saved.externalSessionId);
  }, [createSession, savedSessions, selectLiveSession, sessions]);

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
    source.onopen = () => setEventStreamConnected(true);
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
    source.onerror = () => setEventStreamConnected(false);
    const selectSession = (message: Event) => {
      const session = (message as CustomEvent<AgentSessionSummary>).detail;
      setSessions((current) => [...current.filter((item) => item.id !== session.id), session]);
      preferredSessionIdRef.current = session.id;
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
      const status = root.querySelector<HTMLElement>('.agent-status-line');
      if (status !== null) {
        gsap.fromTo(status, { autoAlpha: 0.4 }, { autoAlpha: 1, duration: 0.22, ease: 'power2.out' });
      }
    });
    return () => media.revert();
  }, [stream.length, selectedSessionId, documentContextOn, chatSummary.phase, chatSummary.label, chatSummary.usage]);

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


  // The agent's system prompt already names the active document, so this chip
  // is a readout: it shows what the agent can see and lets the user turn the
  // per-message reminder off if it is redundant for them.
  function toggleDocumentContext(): void {
    setDocumentContextOn((current) => !current);
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
    const reminder = activeDocument?.cvId != null ? `Work on the active document (cv ${activeDocument.cvId}).\n\n` : '';
    const requestText = documentContextOn ? `${reminder}${text}` : text;
    const sessionId = selectedSessionId;
    if (text.length === 0) return;
    if (sessionId === null) {
      window.dispatchEvent(new CustomEvent('seevee:open-settings', { detail: 'agents' }));
      return;
    }
    const promptId = crypto.randomUUID();
    const externalSessionId = selectedSession?.externalSessionId;
    const createdAt = new Date().toISOString();
    if (externalSessionId !== null && externalSessionId !== undefined) {
      // Optimistic echo: the message appears immediately, then the session
      // record becomes the source of truth on the next snapshot.
      setPendingPrompts((current) => ({
        ...current,
        [externalSessionId]: [...(current[externalSessionId] ?? []), { id: promptId, text, createdAt }],
      }));
    }
    setComposer('');
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/agents/session/${encodeURIComponent(sessionId)}/prompt`, {
        method: 'POST',
        headers: jsonHeaders(),
        body: JSON.stringify({ text: requestText, displayText: text, delivery: 'auto', promptId }),
      });
      await readJson(response);
      await refreshSnapshot();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(false);
    }
  }

  async function interrupt(): Promise<void> {
    if (selectedSessionId === null || interrupting) return;
    const sessionId = selectedSessionId;
    setInterrupting(true);
    setError(null);
    try {
      const response = await fetch(`/api/agents/session/${encodeURIComponent(sessionId)}/interrupt`, {
        method: 'POST',
        headers: jsonHeaders(),
      });
      await readJson(response);
      await refreshSnapshot();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setInterrupting(false);
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
      const questionItem = timeline.find((item) => item.approvalId === approvalId && item.kind === 'approval');
      const questions = questionItem === undefined ? [] : extractAgentQuestions(questionItem.raw);
      const answered = questions
        .map((question, index) => questionAnswers[question.id ?? `question_${index + 1}`] ?? '')
        .filter((answer) => answer.trim().length > 0);
      const payload = questions.length > 0 ? buildAnswerPayload(questions, answered) : value;
      const response = await fetch(`/api/agents/session/${encodeURIComponent(selectedSessionId)}/approval`, {
        method: 'POST',
        headers: jsonHeaders(),
        body: JSON.stringify({ approvalId, decision, ...(payload === undefined ? {} : { value: payload }) }),
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
  const liveExternalSessionIds = new Set(sessions.map((session) => session.externalSessionId).filter((value): value is string => value !== null));
  // A live session summary carries no prompts, so borrow the stored ones to
  // label it by what was actually asked.
  const promptsByExternalId = new Map(savedSessions.map((session) => [session.externalSessionId, session.prompts ?? []]));
  const historySessions = savedSessions.filter((session) => !liveExternalSessionIds.has(session.externalSessionId));
  const sessionEntries: SessionEntry[] = [
    ...sessions.map((session) => sessionEntry({
      value: `live:${session.id}`,
      provider: session.provider,
      title: session.title,
      state: session.state,
      lastActivityAt: session.lastActivityAt,
      ...(session.externalSessionId === null ? {} : { prompts: promptsByExternalId.get(session.externalSessionId) }),
    })),
    ...historySessions.map((session) => sessionEntry({
      value: `saved:${session.externalSessionId}`,
      provider: session.provider,
      title: session.title,
      state: session.state,
      lastActivityAt: session.lastActivityAt,
      prompts: session.prompts ?? [],
    })),
  ];
  const statusTitle = chatSummary.phase === 'working' && chatSummary.elapsed !== null
    ? `Working (${chatSummary.elapsed})`
    : chatSummary.phase === 'completed' && chatSummary.elapsed !== null
      ? `Worked for ${chatSummary.elapsed}`
      : chatSummary.label;

  return (
    <section ref={rootRef} className="agent-chat" aria-label="Agent chat" data-workspace-id={workspaceId}>
      <header className="agent-header">
        <div className="agent-header-bar">
          <div className="agent-header-identity">
            <span className="agent-avatar" aria-hidden="true" />
            <AgentProviderPicker
              providers={providers}
              selectedProvider={selectedSession?.provider ?? null}
              disabled={sessionActionBusy}
              onSelect={(providerId) => void selectProvider(providerId)}
            />
            {configuration?.model ? <span className="agent-header-model" title={configuration.model}>{configuration.model}</span> : null}
          </div>
          <div className="agent-header-actions">
            <button
              type="button"
              className="agent-header-icon"
              title={`New ${activeProviderLabel} session`}
              aria-label={`New ${activeProviderLabel} session`}
              disabled={sessionActionBusy}
              onClick={() => void startNewSession()}
            >
              <Plus size={16} strokeWidth={1.8} aria-hidden="true" />
            </button>
            <button
              type="button"
              className="agent-header-icon"
              title="Refresh agents and dynamic settings"
              aria-label="Refresh agents and dynamic settings"
              onClick={() => { void refreshSnapshot(true); if (selectedSessionId !== null) void loadSessionConfiguration(selectedSessionId); }}
            >
              <RefreshCw size={15} strokeWidth={1.8} aria-hidden="true" />
            </button>
          </div>
        </div>
        <SessionPicker
          entries={sessionEntries}
          selectedValue={selectedSessionId === null ? '' : `live:${selectedSessionId}`}
          busy={sessionActionBusy}
          onSelect={(value) => void selectSessionOption(value)}
        />
        {!eventStreamConnected && (
          <div className="agent-connection-status" role="status" aria-live="polite">
            <RefreshCw size={12} aria-hidden="true" /> Live updates reconnecting
          </div>
        )}
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
        {stream.map((entry, index) => {
          const last = index === stream.length - 1;
          if (entry.kind === 'prompt') {
            return (
              <article key={entry.key} className="agent-message is-user" data-last-timeline-item={String(last)}>
                <div className="agent-message-body">
                  <p>{entry.prompt.text}</p>
                  <footer className="agent-message-meta">
                    <span className="agent-author">You</span>
                    <time dateTime={entry.prompt.createdAt}>{formatClock(entry.prompt.createdAt)}</time>
                    <CopyButton text={entry.prompt.text} />
                  </footer>
                </div>
              </article>
            );
          }
          const item = entry.item;
          return (
            <TimelineItemView
              key={entry.key}
              item={item}
              last={last}
              busy={busy}
              providerLabel={activeProviderLabel === 'No agent' ? 'Agent' : activeProviderLabel}
              answers={questionAnswers}
              onAnswerChange={(questionId, value) => {
                if (questionId === '__reset__') {
                  setQuestionAnswers({});
                  return;
                }
                setQuestionAnswers((current) => ({ ...current, [questionId]: value }));
              }}
              onApproval={resolveApproval}
              elicitationValue={item.approvalId === null ? '' : (elicitationValues[item.approvalId] ?? '')}
              onElicitationChange={(value) => {
                if (item.approvalId === null) return;
                setElicitationValues((current) => ({ ...current, [item.approvalId as string]: value }));
              }}
            />
          );
        })}
        {selectedSessionId !== null && chatSummary.phase !== 'idle' && (
          <p className="agent-status-line" data-phase={chatSummary.phase} role="status" aria-live="polite">
            <span className="agent-status-orb" aria-hidden="true" />
            <span className="agent-status-lead">{statusTitle}</span>
            {chatSummary.detail !== null && <span className="agent-status-detail">{chatSummary.detail}</span>}
            {chatSummary.usage !== null && <span className="agent-status-usage">{chatSummary.usage}</span>}
          </p>
        )}
      </div>

      <footer className="agent-composer-dock">
        {currentPlan !== null && <PlanDock key={currentPlan.id} item={currentPlan} />}
        <div className="agent-composer">
          {documentContextOn && activeDocument !== null && (
            <button className="agent-context-chip" type="button" onClick={toggleDocumentContext} title="Stop telling the agent which document is open">
              <FileText size={12} aria-hidden="true" /> <span>{activeDocument.cvId ?? 'no CV open'}</span> <X size={12} aria-hidden="true" />
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
            <button className="agent-plus-button" type="button" onClick={toggleDocumentContext} aria-label="Tell the agent which document is open" aria-pressed={documentContextOn} title={documentContextOn ? 'Document context is included' : 'Include the open document'}>
              <FileText size={16} strokeWidth={1.8} aria-hidden="true" />
            </button>
            <span className="agent-toolbar-spacer" />
            {active && <button type="button" className="agent-stop-button" onClick={() => void interrupt()} disabled={interrupting} aria-label={interrupting ? 'Stopping agent' : 'Stop agent'}><Square size={11} fill="currentColor" aria-hidden="true" /> {interrupting ? 'Stopping…' : 'Stop'}</button>}
            <div className="agent-config-selects" aria-label="Agent configuration">
              <ConfigurationPicker
                ariaLabel="Agent model"
                label="Model"
                searchable
                value={configuration?.model ?? ''}
                emptyLabel={configurationLoading ? 'Loading models…' : 'Provider default'}
                options={configuration?.models ?? []}
                disabled={configurationLoading || selectedSessionId === null}
                onSelect={(value) => { if (value.length > 0) void updateConfiguration({ model: value }); }}
              />
              <ConfigurationPicker
                ariaLabel="Agent permission mode"
                label="Permissions"
                value={configuration?.permissionMode ?? ''}
                emptyLabel={configurationLoading ? 'Loading permissions…' : 'Permissions'}
                options={configuration?.permissions ?? []}
                disabled={configurationLoading || selectedSessionId === null}
                onSelect={(value) => void updateConfiguration({ permissionMode: value })}
              />
            </div>
            <button className="agent-send-orb" type="button" onClick={() => void sendPrompt()} disabled={busy || selectedSessionId === null || composer.trim().length === 0} aria-label={active ? 'Send follow-up' : 'Run prompt'}>
              <Send size={16} strokeWidth={2} aria-hidden="true" />
            </button>
          </div>
        </div>
        <nav className="agent-quickbar" aria-label="Workspace shortcuts">
          <button type="button" onClick={() => window.dispatchEvent(new CustomEvent('seevee:focus-editor'))}><FileText size={13} aria-hidden="true" /> Document</button>
          <button type="button" onClick={() => window.dispatchEvent(new CustomEvent('seevee:focus-sources'))}><FolderOpen size={13} aria-hidden="true" /> Sources</button>
          <button type="button" onClick={() => window.dispatchEvent(new CustomEvent('seevee:open-settings', { detail: 'agents' }))}><Settings2 size={13} aria-hidden="true" /> Agent setup</button>
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
  providerLabel: string;
  elicitationValue: string;
  answers: Record<string, string>;
  onAnswerChange: (questionId: string, value: string) => void;
  onApproval: (approvalId: string, decision: 'allow-once' | 'allow-session' | 'deny' | 'cancel') => Promise<void>;
  onElicitationChange: (value: string) => void;
}
export function TimelineItemView({ item, last, busy, providerLabel, elicitationValue, answers, onAnswerChange, onApproval, onElicitationChange }: TimelineItemViewProps) {
  if (item.kind === 'assistant') {
    return (
      <article className="agent-message is-assistant" data-last-timeline-item={String(last)} data-status={item.status}>
        <div className="agent-message-body">
          <header className="agent-message-meta">
            <span className="agent-avatar" aria-hidden="true" />
            <span className="agent-author">{providerLabel}</span>
            {item.status === 'streaming' && <span className="agent-live-mark" aria-label="Streaming" />}
            <time dateTime={new Date(item.at).toISOString()}>{formatClock(item.at)}</time>
            {item.text.length > 0 && <CopyButton text={item.text} />}
          </header>
          {item.text.length > 0
            ? <MarkdownMessage text={item.text} />
            : <p className="agent-message-placeholder">Working…</p>}
        </div>
      </article>
    );
  }
  if (item.kind === 'reasoning') {
    // Providers that stream reasoning text get a disclosure; providers that
    // stream an empty content array still get a visible heartbeat, because
    // silence here is indistinguishable from a frozen run.
    if (item.text.trim().length === 0) {
      const live = item.status === 'streaming' && last;
      return (
        <p className="agent-thinking" data-live={String(live)} data-last-timeline-item={String(last)} role="status">
          <span className="agent-thinking-dots" aria-hidden="true"><i /><i /><i /></span>
          <span>{live ? 'Thinking' : 'Thought'}</span>
        </p>
      );
    }
    return (
      <details className="agent-reasoning" data-last-timeline-item={String(last)} data-status={item.status}>
        <summary><span>Thinking</span><small>{item.status === 'streaming' ? 'in progress' : 'summary'}</small></summary>
        <pre>{item.text}</pre>
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
    const questions = isUserQuestionRequest(request) ? extractAgentQuestions(request) : [];
    if (questions.length > 0) {
      return (
        <AgentQuestionCard
          item={item}
          last={last}
          busy={busy}
          questions={questions}
          answers={answers}
          onAnswerChange={onAnswerChange}
          onSubmit={(approvalId, decision) => onApproval(approvalId, decision)}
        />
      );
    }
    const isElicitation = typeof request['kind'] === 'string' && request['kind'].includes('elicitation');
    return (
      <article className="agent-approval" data-last-timeline-item={String(last)} data-pending-approval={String(pending)}>
        <header><CircleAlert size={15} aria-hidden="true" /> Approval required</header>
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
      <details className="agent-event-card is-error" data-last-timeline-item={String(last)} data-status="failed">
        <summary className="agent-event-summary">
          <span><CircleAlert size={14} aria-hidden="true" /> {item.title}</span>
          <small>{firstLine(item.text) || 'failed'}</small>
        </summary>
        <p>{item.text || 'The agent could not complete this run.'}</p>
        <details className="agent-technical-details"><summary>Technical details</summary><pre>{JSON.stringify(item.raw, null, 2)}</pre></details>
      </details>
    );
  }
  // Everything a command produced — output and failures alike — lives inside
  // one collapsed row. A full stack trace per call buries the conversation,
  // so the row reports only how many calls failed until it is opened.
  const failures = item.failures ?? [];
  return (
    <article
      className={`agent-event-card is-${item.kind}`}
      data-last-timeline-item={String(last)}
      data-status={item.status}
    >
      <details className="agent-activity-collapse">
        <summary className="agent-event-summary"><span><Wrench size={13} aria-hidden="true" /> {item.title}</span></summary>
        {item.activityDetail !== null && item.activityDetail !== undefined && item.activityDetail.length > 0
          && <p className="agent-event-detail">{item.activityDetail}</p>}
        {failures.map((failure, index) => (
          <div className="agent-activity-failure" key={`${item.id}-failure-${index}`}>
            {failure.input !== null && <code className="agent-failure-input">{failure.input}</code>}
            <pre className="agent-tool-output">{failure.output}</pre>
          </div>
        ))}
        {item.text.length > 0 && <pre className="agent-tool-output">{item.text}</pre>}
        <details className="agent-technical-details"><summary>Technical details</summary><pre>{JSON.stringify(item.raw, null, 2)}</pre></details>
      </details>
    </article>
  );
}

/**
 * Ask-the-user card. Options are one click, and a free-text field is always
 * available so nobody is forced into a choice that does not fit — the agent
 * is blocked until the user answers, so "none of these" has to be a real
 * answer, not a dead end.
 */
function AgentQuestionCard({
  item,
  last,
  busy,
  questions,
  answers,
  onAnswerChange,
  onSubmit,
}: {
  item: TimelineItem;
  last: boolean;
  busy: boolean;
  questions: AgentQuestion[];
  answers: Record<string, string>;
  onAnswerChange: (questionId: string, value: string) => void;
  onSubmit: (approvalId: string, decision: 'allow-once' | 'deny') => Promise<void>;
}) {
  const pending = item.status === 'pending' && item.approvalId !== null;
  const keyed = questions.map((question, index) => question.id ?? `question_${index + 1}`);
  const answered = questions.every((_, index) => (answers[keyed[index]] ?? '').trim().length > 0);

  if (!pending) {
    return (
      <article className="agent-question" data-last-timeline-item={String(last)} data-resolved="true">
        <header><MessageCircleQuestion size={15} aria-hidden="true" /> {item.title}</header>
        {questions.map((question, index) => (
          <p className="agent-question-answer" key={keyed[index]}>
            {question.question} — <strong>{answers[keyed[index]] ?? 'skipped'}</strong>
          </p>
        ))}
      </article>
    );
  }

  return (
    <article className="agent-question" data-last-timeline-item={String(last)} data-pending-approval="true">
      <header><MessageCircleQuestion size={15} aria-hidden="true" /> {item.title}</header>
      {questions.map((question, index) => {
        const key = keyed[index]!;
        const chosen = answers[key] ?? '';
        const custom = chosen.length > 0 && !question.options.some((option) => option.label === chosen);
        return (
          <fieldset className="agent-question-set" key={key}>
            <legend>{question.question}</legend>
            {question.options.map((option) => (
              <label className="agent-question-option" key={option.label}>
                <input
                  type="radio"
                  name={key}
                  value={option.label}
                  checked={chosen === option.label}
                  onChange={() => onAnswerChange(key, option.label)}
                />
                <span>
                  <strong>{option.label}</strong>
                  {option.description !== null && <small>{option.description}</small>}
                </span>
              </label>
            ))}
            <label className="agent-question-option is-other">
              <input
                type="radio"
                name={key}
                value="__other__"
                checked={custom}
                onChange={() => onAnswerChange(key, '')}
              />
              <span>Something else</span>
            </label>
            {custom && (
              <textarea
                className="agent-question-freeform"
                rows={2}
                value={chosen}
                placeholder="Type your answer"
                onChange={(event) => onAnswerChange(key, event.target.value)}
              />
            )}
          </fieldset>
        );
      })}
      <div className="agent-question-actions">
        <button
          type="button"
          className="button button-primary"
          disabled={busy || !answered || item.approvalId === null}
          onClick={() => {
            if (item.approvalId === null) return;
            void onSubmit(item.approvalId, 'allow-once').then(() => onAnswerChange('__reset__', ''));
          }}
        >
          Send answer
        </button>
        <button
          type="button"
          className="button button-subtle"
          disabled={busy}
          onClick={() => item.approvalId !== null && void onSubmit(item.approvalId, 'deny')}
        >
          Skip
        </button>
      </div>
    </article>
  );
}

/** Compact, keyboard-accessible picker shared by model and permission controls. */
function ConfigurationPicker({
  ariaLabel,
  label,
  value,
  emptyLabel,
  options,
  searchable = false,
  disabled,
  onSelect,
}: {
  ariaLabel: string;
  label: string;
  value: string;
  emptyLabel: string;
  options: readonly { id: string; label: string }[];
  searchable?: boolean;
  disabled: boolean;
  onSelect: (value: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const [query, setQuery] = useState('');
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const entries = [{ id: '', label: emptyLabel }, ...options];
  const canSearch = searchable && options.length >= 8;
  const filteredEntries = canSearch && query.trim().length > 0
    ? entries.filter((entry) => entry.label.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()) || entry.id.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()))
    : entries;
  const selectedIndex = Math.max(0, filteredEntries.findIndex((entry) => entry.id === value));
  const selected = entries[Math.max(0, entries.findIndex((entry) => entry.id === value))] ?? entries[0]!;

  const closeMenu = (restoreFocus = false) => {
    if (!open) return;
    animateDropdownClose(menuRef.current, 'up', () => setOpen(false));
    setQuery('');
    if (restoreFocus) buttonRef.current?.focus();
  };

  useEffect(() => {
    if (!open) return;
    const close = (event: PointerEvent) => {
      if (rootRef.current?.contains(event.target as Node) !== true) closeMenu();
    };
    const onEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closeMenu(true);
    };
    document.addEventListener('pointerdown', close);
    document.addEventListener('keydown', onEscape);
    return () => {
      document.removeEventListener('pointerdown', close);
      document.removeEventListener('keydown', onEscape);
    };
  }, [open]);

  useLayoutEffect(() => {
    if (!open) return;
    const position = () => positionChatDropdown(buttonRef.current, menuRef.current, 'up');
    position();
    if (canSearch) searchRef.current?.focus();
    animateDropdownOpen(menuRef.current, 'up');
    window.addEventListener('resize', position);
    document.addEventListener('scroll', position, true);
    return () => {
      window.removeEventListener('resize', position);
      document.removeEventListener('scroll', position, true);
    };
  }, [open, entries.length, canSearch]);

  useEffect(() => {
    if (open) setActiveIndex(selectedIndex);
  }, [open, selectedIndex, query]);

  const commit = (next: string) => {
    closeMenu();
    onSelect(next);
    buttonRef.current?.focus();
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>) => {
    if (event.key === 'Escape') {
      closeMenu(true);
      return;
    }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      if (!open) {
        setOpen(true);
        return;
      }
      const delta = event.key === 'ArrowDown' ? 1 : -1;
      setActiveIndex((current) => (current + delta + filteredEntries.length) % filteredEntries.length);
      return;
    }
    if (event.key === 'Home' || event.key === 'End') {
      event.preventDefault();
      setActiveIndex(event.key === 'Home' ? 0 : filteredEntries.length - 1);
      return;
    }
    if ((event.key === 'Enter' || event.key === ' ') && open) {
      event.preventDefault();
      const entry = filteredEntries[activeIndex];
      if (entry !== undefined) commit(entry.id);
      return;
    }
    if (canSearch && open && event.key.length === 1 && !event.metaKey && !event.ctrlKey && !event.altKey) {
      event.preventDefault();
      setQuery((current) => `${current}${event.key}`);
      searchRef.current?.focus();
    }
  };

  const onSearchKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      closeMenu(true);
    } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      if (filteredEntries.length > 0) {
        setActiveIndex((current) => (current + (event.key === 'ArrowDown' ? 1 : -1) + filteredEntries.length) % filteredEntries.length);
      }
    } else if (event.key === 'Enter') {
      event.preventDefault();
      const entry = filteredEntries[activeIndex];
      if (entry !== undefined) commit(entry.id);
    }
  };

  return (
    <div className="agent-config-picker" ref={rootRef}>
      <button
        ref={buttonRef}
        type="button"
        className="agent-config-trigger"
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        disabled={disabled}
        onClick={() => open ? closeMenu() : setOpen(true)}
        onKeyDown={onKeyDown}
      >
        <span className="agent-config-label">{label}</span>
        <span className="agent-config-value" title={selected.label}>{selected.label}</span>
        <ChevronDown size={13} aria-hidden="true" />
      </button>
      {open && (
        <div className={`agent-config-menu${canSearch ? ' is-searchable' : ''}`} ref={menuRef}>
          {canSearch && (
            <label className="agent-config-search">
              <Search size={13} aria-hidden="true" />
              <input
                ref={searchRef}
                type="search"
                value={query}
                onChange={(event) => setQuery(event.currentTarget.value)}
                onKeyDown={onSearchKeyDown}
                placeholder="Search models…"
                aria-label="Search models"
                autoComplete="off"
                spellCheck={false}
              />
            </label>
          )}
          <div className="agent-config-options" role="listbox" aria-label={ariaLabel}>
          {filteredEntries.map((entry, index) => {
            const selectedOption = entry.id === value;
            return (
              <button
                type="button"
                key={entry.id || '__default__'}
                role="option"
                aria-selected={selectedOption}
                data-active={String(index === activeIndex)}
                onMouseEnter={() => setActiveIndex(index)}
                onClick={() => commit(entry.id)}
              >
                <span>{entry.label}</span>
                {selectedOption && <Check size={13} aria-hidden="true" />}
              </button>
            );
          })}
          {filteredEntries.length === 0 && <p className="agent-config-no-results">No matching models</p>}
          </div>
        </div>
      )}
    </div>
  );
}

/** Compact provider selector in the chat header. */
function AgentProviderPicker({
  providers,
  selectedProvider,
  disabled,
  onSelect,
}: {
  providers: AgentRuntimeSnapshot['providers'];
  selectedProvider: AgentProviderId | null;
  disabled: boolean;
  onSelect: (providerId: AgentProviderId) => void;
}) {
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const selected = providers.find((provider) => provider.id === selectedProvider);

  const closeMenu = (restoreFocus = false) => {
    if (!open) return;
    animateDropdownClose(menuRef.current, 'down', () => setOpen(false));
    if (restoreFocus) buttonRef.current?.focus();
  };

  useEffect(() => {
    if (!open) return;
    const closeOnOutside = (event: PointerEvent) => {
      if (rootRef.current?.contains(event.target as Node) !== true) closeMenu();
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closeMenu(true);
    };
    document.addEventListener('pointerdown', closeOnOutside);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('pointerdown', closeOnOutside);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [open]);

  useLayoutEffect(() => {
    if (!open) return;
    const position = () => positionChatDropdown(buttonRef.current, menuRef.current, 'down', true);
    position();
    animateDropdownOpen(menuRef.current, 'down');
    window.addEventListener('resize', position);
    document.addEventListener('scroll', position, true);
    return () => {
      window.removeEventListener('resize', position);
      document.removeEventListener('scroll', position, true);
    };
  }, [open, providers.length]);

  useEffect(() => {
    if (!open) return;
    const index = providers.findIndex((provider) => provider.id === selectedProvider);
    setActiveIndex(index >= 0 ? index : Math.max(0, providers.findIndex((provider) => provider.ready)));
  }, [open, providers, selectedProvider]);

  const commit = (providerId: AgentProviderId) => {
    closeMenu();
    onSelect(providerId);
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>) => {
    if (event.key === 'Escape') {
      closeMenu(true);
      return;
    }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      if (!open) {
        setOpen(true);
        return;
      }
      const delta = event.key === 'ArrowDown' ? 1 : -1;
      setActiveIndex((index) => (index + delta + providers.length) % Math.max(1, providers.length));
      return;
    }
    if ((event.key === 'Enter' || event.key === ' ') && open) {
      event.preventDefault();
      const provider = providers[activeIndex];
      if (provider?.ready) commit(provider.id);
    }
  };

  return (
    <div className="agent-provider-picker" ref={rootRef}>
      <button
        ref={buttonRef}
        type="button"
        className="agent-provider-trigger"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={`Agent: ${selected?.label ?? 'Choose an agent'}`}
        disabled={disabled}
        onClick={() => open ? closeMenu() : setOpen(true)}
        onKeyDown={onKeyDown}
      >
        <span>{selected?.label ?? 'Choose agent'}</span>
        <ChevronDown size={13} aria-hidden="true" />
      </button>
      {open && (
        <div className="agent-provider-menu" role="listbox" aria-label="Choose agent" ref={menuRef}>
          {providers.map((provider, index) => (
            <button
              type="button"
              role="option"
              aria-selected={provider.id === selectedProvider}
              aria-disabled={!provider.ready}
              data-active={String(index === activeIndex)}
              className="agent-provider-option"
              key={provider.id}
              disabled={!provider.ready}
              onMouseEnter={() => setActiveIndex(index)}
              onClick={() => commit(provider.id)}
            >
              <span className={`agent-session-dot${provider.ready ? ' is-running' : ''}`} aria-hidden="true" />
              <span className="agent-provider-option-copy">
                <span>{provider.label}</span>
                <small>{provider.ready ? 'Ready' : provider.message ?? 'Not available'}</small>
              </span>
              {provider.id === selectedProvider && <Check size={14} aria-hidden="true" />}
            </button>
          ))}
          {providers.length === 0 && <p className="agent-session-empty">Loading agents…</p>}
        </div>
      )}
    </div>
  );
}

/**
 * Session picker.
 *
 * Replaces a native `<select>`, which could not show the Active/History
 * split, gave every session the same flat string, and truncated the very
 * titles that identify one conversation from another. This is a real
 * listbox: buttons, arrow-key navigation, Escape, and click-outside.
 */
function SessionPicker({
  entries,
  selectedValue,
  busy,
  onSelect,
}: {
  entries: readonly SessionEntry[];
  selectedValue: string;
  busy: boolean;
  onSelect: (value: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const selectedIndex = entries.findIndex((entry) => entry.value === selectedValue);
  const selected = selectedIndex >= 0 ? entries[selectedIndex] : undefined;

  const closeMenu = (restoreFocus = false) => {
    if (!open) return;
    animateDropdownClose(listRef.current, 'down', () => setOpen(false));
    if (restoreFocus) buttonRef.current?.focus();
  };

  useEffect(() => {
    if (!open) return;
    const close = (event: PointerEvent) => {
      if (rootRef.current?.contains(event.target as Node) === true) return;
      closeMenu();
    };
    const onEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closeMenu(true);
    };
    document.addEventListener('pointerdown', close);
    document.addEventListener('keydown', onEscape);
    return () => {
      document.removeEventListener('pointerdown', close);
      document.removeEventListener('keydown', onEscape);
    };
  }, [open]);

  useLayoutEffect(() => {
    if (!open) return;
    const position = () => positionChatDropdown(buttonRef.current, listRef.current, 'down');
    position();
    animateDropdownOpen(listRef.current, 'down');
    window.addEventListener('resize', position);
    document.addEventListener('scroll', position, true);
    return () => {
      window.removeEventListener('resize', position);
      document.removeEventListener('scroll', position, true);
    };
  }, [open, entries.length]);

  useEffect(() => {
    if (!open) return;
    setActiveIndex(selectedIndex >= 0 ? selectedIndex : 0);
  }, [open, selectedIndex]);

  useEffect(() => {
    if (!open) return;
    listRef.current?.querySelector<HTMLElement>('[data-active="true"]')?.scrollIntoView({ block: 'nearest' });
  }, [open, activeIndex]);

  const commit = (value: string) => {
    closeMenu();
    onSelect(value);
  };

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === 'Escape') {
      closeMenu(true);
      return;
    }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      if (!open) {
        setOpen(true);
        return;
      }
      const delta = event.key === 'ArrowDown' ? 1 : -1;
      setActiveIndex((current) => (current + delta + entries.length) % entries.length);
      return;
    }
    if (event.key === 'Home' || event.key === 'End') {
      event.preventDefault();
      setActiveIndex(event.key === 'Home' ? 0 : entries.length - 1);
      return;
    }
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      const entry = entries[open ? activeIndex : selectedIndex];
      if (entry !== undefined) commit(entry.value);
    }
  };

  const groups: { label: string; items: SessionEntry[] }[] = [
    { label: 'Active', items: entries.filter((entry) => !entry.value.startsWith('saved:')) },
    { label: 'History', items: entries.filter((entry) => entry.value.startsWith('saved:')) },
  ].filter((group) => group.items.length > 0);

  let flatIndex = -1;

  return (
    <div className="agent-session-picker" ref={rootRef}>
      <button
        ref={buttonRef}
        type="button"
        className="agent-session-trigger"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={selected === undefined ? 'Select agent session' : `Session: ${selected.title}`}
        title={selected?.title}
        disabled={busy}
        onClick={() => open ? closeMenu() : setOpen(true)}
        onKeyDown={onKeyDown}
      >
        <span className={`agent-session-dot${selected?.running === true ? ' is-running' : ''}`} aria-hidden="true" />
        <span className="agent-session-current">
          <span className="agent-session-agent">{selected?.providerLabel ?? 'No session'}</span>
          <span className="agent-session-title">{selected?.title ?? 'Choose a session'}</span>
        </span>
        <span className="agent-session-time">{selected?.time ?? ''}</span>
        <ChevronDown className="agent-session-caret" size={14} aria-hidden="true" />
      </button>
      {open && (
        <div className="agent-session-menu" role="listbox" aria-label="Agent sessions" ref={listRef}>
          {groups.length === 0 && <p className="agent-session-empty">No sessions yet.</p>}
          {groups.map((group) => (
            <div className="agent-session-group" key={group.label}>
              <p className="agent-session-group-label">{group.label}</p>
              {group.items.map((entry) => {
                flatIndex += 1;
                const index = flatIndex;
                const isSelected = entry.value === selectedValue;
                return (
                  <div
                    key={entry.value}
                    role="option"
                    aria-selected={isSelected}
                    data-active={String(index === activeIndex)}
                    className="agent-session-option"
                    title={entry.title}
                    onMouseEnter={() => setActiveIndex(index)}
                    onClick={() => commit(entry.value)}
                  >
                    <span className={`agent-session-dot${entry.running ? ' is-running' : ''}`} aria-hidden="true" />
                    <span className="agent-session-current">
                      <span className="agent-session-agent">{entry.providerLabel}</span>
                      <span className="agent-session-title">{entry.title}</span>
                    </span>
                    <span className="agent-session-time">{entry.time}</span>
                    {isSelected && <Check className="agent-session-check" size={14} aria-hidden="true" />}
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
