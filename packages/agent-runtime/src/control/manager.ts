import { randomUUID } from 'node:crypto';
import type {
  AdapterApprovalResolution,
  AdapterSession,
  AgentAdapter,
} from './adapter.js';
import {
  type AgentEvent,
  type AgentEventInput,
  type AgentPromptResult,
  type AgentProviderDescriptor,
  type AgentProviderId,
  type AgentRuntimeSnapshot,
  type AgentSessionState,
  type AgentSessionConfiguration,
  type AgentSessionSummary,
  type CreateAgentSessionRequest,
  type PromptAgentRequest,
  type ResolveAgentApprovalRequest,
  type UpdateAgentSessionRequest,
} from './types.js';
import { seeveeAgentInstructions } from './seevee-agent.js';
import { formatWorkspaceContext, readWorkspaceContext } from './workspace-context.js';

/**
 * Build the system instructions for a session: the standing workspace rules
 * plus a factual block naming the document the user currently has open and
 * whether this conversation continues an earlier one.
 */
async function buildSessionInstructions(workspaceRoot: string, resumed: boolean): Promise<string> {
  const context = await readWorkspaceContext(workspaceRoot);
  return seeveeAgentInstructions(formatWorkspaceContext(context, { resumed }));
}

interface ManagedSession {
  summary: AgentSessionSummary;
  currentTurnId: string | null;
  adapter: AgentAdapter;
  controller: AbortController;
  session: AdapterSession;
}

export type AgentEventSink = (event: AgentEvent) => void;

const MAX_TIMELINE_EVENTS = 1_000;
const PROVIDER_CACHE_MS = 30_000;

export class AgentRuntimeError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = 'AgentRuntimeError';
    this.code = code;
  }
}

export class AgentRuntimeManager {
  private readonly adapters = new Map<AgentProviderId, AgentAdapter>();
  private readonly sessions = new Map<string, ManagedSession>();
  private readonly events: AgentEvent[] = [];
  private readonly emitToHost: AgentEventSink;
  private providerCache: { expiresAt: number; providers: AgentProviderDescriptor[] } | null = null;
  private sequence = 0;

  constructor(emitToHost: AgentEventSink) {
    this.emitToHost = emitToHost;
  }

  register(adapter: AgentAdapter): void {
    this.adapters.set(adapter.id, adapter);
  }

  async detectProviders(force = false): Promise<AgentProviderDescriptor[]> {
    if (!force && this.providerCache !== null && this.providerCache.expiresAt > Date.now()) {
      return this.providerCache.providers;
    }
    const providers = await Promise.all(
      [...this.adapters.values()].map(async (adapter) => {
        try {
          return await adapter.detect();
        } catch (error) {
          return {
            id: adapter.id,
            label: adapter.id,
            command: adapter.command,
            installed: false,
            status: 'error' as const,
            version: null,
            executablePath: null,
            ready: false,
            capabilities: {
              streaming: false,
              reasoning: false,
              toolCalls: false,
              approvals: false,
              steering: false,
              sessionResume: false,
              modelSelection: false,
              usage: false,
              subagents: false,
              mcp: false,
            },
            message: error instanceof Error ? error.message : String(error),
          } satisfies AgentProviderDescriptor;
        }
      }),
    );
    providers.sort((a, b) => a.label.localeCompare(b.label));
    this.providerCache = { expiresAt: Date.now() + PROVIDER_CACHE_MS, providers };
    return providers;
  }

  async createSession(request: CreateAgentSessionRequest, workspaceRoot: string): Promise<AgentSessionSummary> {
    const adapter = this.adapters.get(request.provider);
    if (adapter === undefined) {
      throw new AgentRuntimeError('AGENT_NOT_REGISTERED', `No adapter is registered for ${request.provider}.`);
    }
    const descriptor = (await this.detectProviders()).find((provider) => provider.id === request.provider);
    if (descriptor === undefined || !descriptor.installed || descriptor.executablePath === null) {
      throw new AgentRuntimeError('AGENT_NOT_INSTALLED', `${descriptor?.label ?? request.provider} is not installed.`);
    }
    if (!descriptor.ready) {
      throw new AgentRuntimeError('AGENT_NOT_READY', descriptor.message ?? `${descriptor.label} is not ready.`);
    }

    const internalSessionId = `agent_${randomUUID()}`;
    const controller = new AbortController();
    const createdAt = new Date().toISOString();
    const emit = (event: AgentEventInput) => this.publish(request.provider, internalSessionId, event);
    const adapterSession = await adapter.createSession({
      workspaceRoot,
      executablePath: descriptor.executablePath,
      ...(request.resumeSessionId === undefined ? {} : { resumeSessionId: request.resumeSessionId }),
      instructions: await buildSessionInstructions(workspaceRoot, request.resumeSessionId !== undefined),
      emit,
      signal: controller.signal,
    });
    const summary: AgentSessionSummary = {
      id: internalSessionId,
      provider: request.provider,
      externalSessionId: adapterSession.externalSessionId,
      title: `${descriptor.label} session`,
      state: 'idle',
      model: null,
      createdAt,
      lastActivityAt: createdAt,
      capabilities: adapterSession.capabilities,
      error: null,
    };
    this.sessions.set(internalSessionId, {
      summary,
      currentTurnId: null,
      adapter,
      controller,
      session: adapterSession,
    });
    this.publish(request.provider, internalSessionId, {
      type: 'session.created',
      turnId: null,
      approvalId: null,
      occurredAt: createdAt,
      data: {
        externalSessionId: adapterSession.externalSessionId,
        capabilities: adapterSession.capabilities,
      },
    });
    return { ...summary };
  }

  async sendPrompt(sessionId: string, request: PromptAgentRequest): Promise<AgentPromptResult> {
    const managed = this.requireSession(sessionId);
    managed.summary.error = null;
    const result = await managed.session.sendPrompt({ text: request.text, delivery: request.delivery });
    if (result.mode === 'new-turn') {
      this.publish(managed.summary.provider, sessionId, {
        type: 'turn.started',
        turnId: result.turnId,
        approvalId: null,
        data: { delivery: request.delivery },
      });
    } else if (result.mode === 'queued') {
      this.publish(managed.summary.provider, sessionId, {
        type: 'turn.queued',
        turnId: result.turnId,
        approvalId: null,
        data: { queued: true, delivery: request.delivery },
      });
    } else {
      this.publish(managed.summary.provider, sessionId, {
        type: 'subactivity.updated',
        turnId: result.turnId,
        approvalId: null,
        data: { kind: 'steering', message: 'Follow-up delivered to the active turn.' },
      });
    }
    return result;
  }

  async interrupt(sessionId: string): Promise<void> {
    const managed = this.requireSession(sessionId);
    await managed.session.interrupt();
  }

  async resolveApproval(sessionId: string, request: ResolveAgentApprovalRequest): Promise<void> {
    const managed = this.requireSession(sessionId);
    const resolution: AdapterApprovalResolution = {
      decision: request.decision,
      ...(request.optionId === undefined ? {} : { optionId: request.optionId }),
      ...(request.message === undefined ? {} : { message: request.message }),
      ...(request.value === undefined ? {} : { value: request.value }),
    };
    await managed.session.resolveApproval(request.approvalId, resolution);
    this.publish(managed.summary.provider, sessionId, {
      type: 'approval.resolved',
      turnId: managed.currentTurnId,
      approvalId: request.approvalId,
      data: { decision: request.decision },
    });
  }

  async updateSession(sessionId: string, request: UpdateAgentSessionRequest): Promise<AgentSessionSummary> {
    const managed = this.requireSession(sessionId);
    await managed.session.updateConfig({
      ...(request.model === undefined ? {} : { model: request.model }),
      ...(request.permissionMode === undefined ? {} : { permissionMode: request.permissionMode }),
    });
    if (request.model !== undefined) managed.summary.model = request.model;
    return { ...managed.summary };
  }

  async getSessionConfiguration(sessionId: string): Promise<AgentSessionConfiguration> {
    return this.requireSession(sessionId).session.getConfiguration();
  }

  emitSessionEvent(sessionId: string, type: AgentEvent['type'], data: unknown): void {
    const managed = this.requireSession(sessionId);
    this.publish(managed.summary.provider, sessionId, {
      type,
      turnId: managed.currentTurnId,
      approvalId: null,
      data,
    });
  }

  async closeSession(sessionId: string): Promise<void> {
    const managed = this.sessions.get(sessionId);
    if (managed === undefined) return;
    await managed.session.close();
    managed.controller.abort();
    managed.summary.state = 'closed';
    managed.summary.lastActivityAt = new Date().toISOString();
    this.sessions.delete(sessionId);
  }

  snapshot(): AgentRuntimeSnapshot {
    return {
      schema: 'seevee.agent-runtime.snapshot.v1',
      seq: this.sequence,
      providers: this.providerCache?.providers ?? [],
      sessions: [...this.sessions.values()].map(({ summary }) => ({ ...summary })),
      events: this.events.map((event) => ({ ...event })),
    };
  }

  async shutdown(): Promise<void> {
    await Promise.allSettled([...this.sessions.keys()].map((sessionId) => this.closeSession(sessionId)));
  }

  private requireSession(sessionId: string): ManagedSession {
    const managed = this.sessions.get(sessionId);
    if (managed === undefined) {
      throw new AgentRuntimeError('AGENT_SESSION_NOT_FOUND', `Agent session ${sessionId} was not found.`);
    }
    return managed;
  }

  private publish(provider: AgentProviderId, sessionId: string, input: AgentEventInput): void {
    const event: AgentEvent = {
      schema: 'seevee.agent-event.v1',
      seq: ++this.sequence,
      provider,
      sessionId,
      turnId: input.turnId,
      approvalId: input.approvalId,
      type: input.type,
      occurredAt: input.occurredAt ?? new Date().toISOString(),
      data: input.data,
    };
    this.events.push(event);
    if (this.events.length > MAX_TIMELINE_EVENTS) this.events.shift();
    const managed = this.sessions.get(sessionId);
    if (managed !== undefined) {
      managed.summary.lastActivityAt = event.occurredAt;
      if (event.turnId !== null) managed.currentTurnId = event.turnId;
      if (managed.summary.externalSessionId === null && event.type === 'session.created') {
        const data = event.data as { externalSessionId?: unknown };
        if (typeof data.externalSessionId === 'string') managed.summary.externalSessionId = data.externalSessionId;
      }
      managed.summary.state = this.stateForEvent(managed.summary.state, event.type);
      if (event.type === 'error' || event.type === 'turn.failed') {
        const data = event.data as { message?: unknown };
        managed.summary.error = typeof data.message === 'string' ? data.message : 'Agent run failed.';
      }
      if (event.type === 'turn.completed' || event.type === 'turn.failed' || event.type === 'turn.cancelled') {
        managed.currentTurnId = null;
      }
    }
    this.emitToHost(event);
  }

  private stateForEvent(current: AgentSessionState, type: AgentEvent['type']): AgentSessionState {
    if (type === 'turn.started' || type === 'message.started' || type === 'tool.started') return 'running';
    if (type === 'approval.requested') return 'waiting-approval';
    if (type === 'approval.resolved' && current === 'waiting-approval') return 'running';
    if (type === 'turn.queued') return current === 'idle' ? 'idle' : 'running';
    if (type === 'turn.completed') return 'completed';
    if (type === 'turn.failed' || type === 'error') return 'failed';
    if (type === 'turn.cancelled') return 'cancelled';
    if (type === 'session.created') return 'idle';
    return current;
  }
}
