import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type {
  AdapterApprovalResolution,
  AdapterPromptOptions,
  AdapterSession,
  AgentAdapter,
  CreateAdapterSessionOptions,
} from '../control/adapter.js';
import {
  JsonRpcProcessClient,
  type JsonRpcNotificationMessage,
  type JsonRpcRequestMessage,
} from '../control/json-rpc.js';
import { asRecord, optionalString, sanitizeAgentValue } from '../control/payload.js';
import {
  DEFAULT_AGENT_CAPABILITIES,
  type AgentCapabilities,
  type AgentEventInput,
  type AgentPromptResult,
  type AgentProviderDescriptor,
  type AgentSelectOption,
  type AgentSessionConfiguration,
} from '../control/types.js';
import { detectCommand } from './detect-command.js';

const initializeResultSchema = z.object({
  protocolVersion: z.number().int(),
  agentInfo: z.object({
    name: z.string(),
    title: z.string().optional(),
    version: z.string(),
  }).optional(),
  agentCapabilities: z.record(z.unknown()).optional(),
});

const sessionResultSchema = z.object({
  sessionId: z.string().min(1),
  modes: z.record(z.unknown()).optional(),
  configOptions: z.array(z.record(z.unknown())).optional(),
});

const OMP_CAPABILITIES: AgentCapabilities = {
  ...DEFAULT_AGENT_CAPABILITIES,
  steering: false,
  subagents: false,
};
const SUPPORTED_ACP_REQUESTS: Record<string, true> = {
  'session/request_permission': true,
  'elicitation/create': true,
};


interface PendingApproval {
  requestId: string | number;
  method: string;
  params: Record<string, unknown>;
}

export function ompPermissionOptionId(
  params: Record<string, unknown>,
  resolution: AdapterApprovalResolution,
): string | null {
  if (typeof resolution.optionId === 'string' && resolution.optionId.length > 0) return resolution.optionId;
  const expectedKind = resolution.decision === 'allow-session'
    ? 'allow_always'
    : resolution.decision === 'deny' ? 'reject_once' : 'allow_once';
  const options = Array.isArray(params['options']) ? params['options'] : [];
  for (const rawOption of options) {
    if (typeof rawOption !== 'object' || rawOption === null) continue;
    const option = rawOption as Record<string, unknown>;
    if (option['kind'] === expectedKind && typeof option['optionId'] === 'string') return option['optionId'];
  }
  return null;
}

export class OmpAdapter implements AgentAdapter {
  readonly id = 'omp' as const;
  readonly command = 'omp';

  async detect(): Promise<AgentProviderDescriptor> {
    const detection = await detectCommand(this.command);
    const installed = detection.executablePath !== null;
    const ready = installed && detection.error === null;
    return {
      id: this.id,
      label: 'oh-my-pi',
      command: this.command,
      installed,
      status: !installed ? 'not-installed' : ready ? 'ready' : 'error',
      version: detection.version,
      executablePath: detection.executablePath,
      ready,
      capabilities: OMP_CAPABILITIES,
      message: detection.error ?? (installed ? 'OMP ACP detected.' : null),
    };
  }

  async createSession(options: CreateAdapterSessionOptions): Promise<AdapterSession> {
    const session = new OmpAdapterSession(options);
    await session.initialize();
    return session;
  }
}

class OmpAdapterSession implements AdapterSession {
  readonly capabilities = OMP_CAPABILITIES;
  externalSessionId: string | null = null;

  private readonly rpc: JsonRpcProcessClient;
  private readonly emit: (event: AgentEventInput) => void;
  private readonly pendingApprovals = new Map<string, PendingApproval>();
  private readonly workspaceRoot: string;
  private readonly signal: AbortSignal;
  private activeTurnId: string | null = null;
  private model: string | null = null;
  private modeId = 'default';
  private permissionMode = 'ask';
  private modelOptions: AgentSelectOption[] = [];
  private closed = false;
  private supportsClose = false;
  private readonly requestedResumeSessionId: string | undefined;

  constructor(options: CreateAdapterSessionOptions) {
    this.workspaceRoot = options.workspaceRoot;
    this.emit = options.emit;
    this.signal = options.signal;
    this.requestedResumeSessionId = options.resumeSessionId;
    this.rpc = new JsonRpcProcessClient({
      command: options.executablePath,
      args: ['acp', '--approval-mode', 'always-ask', '--append-system-prompt', options.instructions],
      cwd: options.workspaceRoot,
      includeJsonRpcVersion: true,
      requestTimeoutMs: 60_000,
    });
    this.rpc.onNotification = (message) => this.handleNotification(message);
    this.rpc.onRequest = (message) => void this.handleServerRequest(message);
    this.rpc.onClose = (error) => {
      if (this.closed) return;
      this.emit({
        type: 'error',
        turnId: this.activeTurnId,
        approvalId: null,
        data: { message: `OMP ACP stopped: ${error?.message ?? 'unknown reason'}` },
      });
    };
    this.signal.addEventListener('abort', () => void this.close(), { once: true });
  }

  async initialize(): Promise<void> {
    const initialized = initializeResultSchema.parse(await this.rpc.request('initialize', {
      protocolVersion: 1,
      clientCapabilities: {
        fs: { readTextFile: false, writeTextFile: false },
        terminal: false,
        elicitation: { form: {}, url: {} },
      },
      clientInfo: { name: 'seevee', title: 'Seevee Studio', version: '0.1.0' },
    }));
    if (initialized.protocolVersion !== 1) {
      throw new Error(`OMP negotiated unsupported ACP protocol ${initialized.protocolVersion}.`);
    }
    this.supportsClose = asRecord(initialized.agentCapabilities?.['sessionCapabilities'])['close'] !== undefined;
    const params = this.requestedResumeSessionId === undefined
      ? { cwd: this.workspaceRoot, mcpServers: [] }
      : { sessionId: this.requestedResumeSessionId, cwd: this.workspaceRoot, mcpServers: [] };
    const method = this.requestedResumeSessionId === undefined ? 'session/new' : 'session/load';
    const result = sessionResultSchema.parse(await this.rpc.request(method, params));
    this.externalSessionId = result.sessionId;
    const modes = asRecord(result.modes);
    this.modeId = optionalString(modes['currentModeId']) ?? 'default';
    this.permissionMode = this.modeId === 'plan' ? 'plan' : 'ask';
    for (const option of result.configOptions ?? []) {
      if (option['id'] !== 'model') continue;
      this.model = optionalString(option['currentValue']);
      const values = Array.isArray(option['options']) ? option['options'] : [];
      this.modelOptions = values.flatMap((rawValue) => {
        if (typeof rawValue !== 'object' || rawValue === null) return [];
        const value = rawValue as Record<string, unknown>;
        const id = optionalString(value['value']);
        if (id === null) return [];
        return [{
          id,
          label: optionalString(value['label']) ?? id,
          description: optionalString(value['description']),
        }];
      });
    }
  }


  async sendPrompt(options: AdapterPromptOptions): Promise<AgentPromptResult> {
    if (this.externalSessionId === null) throw new Error('OMP ACP session is not initialized.');
    const turnId = `omp_turn_${randomUUID()}`;
    const queued = this.activeTurnId !== null;
    this.activeTurnId = turnId;
    void this.runPrompt(turnId, options.text);
    return { turnId, queued, mode: queued ? 'queued' : 'new-turn' };
  }

  async interrupt(): Promise<void> {
    if (this.externalSessionId === null || this.activeTurnId === null) return;
    const turnId = this.activeTurnId;
    this.rpc.notify('session/cancel', { sessionId: this.externalSessionId });
    this.activeTurnId = null;
    this.emit({
      type: 'turn.cancelled',
      turnId,
      approvalId: null,
      data: { message: 'OMP turn cancelled by the user.' },
    });
  }

  async resolveApproval(approvalId: string, resolution: AdapterApprovalResolution): Promise<void> {
    const pending = this.pendingApprovals.get(approvalId);
    if (pending === undefined) throw new Error(`Unknown or resolved OMP approval ${approvalId}.`);
    if (pending.method === 'session/request_permission') {
      if (resolution.decision === 'cancel') {
        this.rpc.respond(pending.requestId, { outcome: { outcome: 'cancelled' } });
        this.pendingApprovals.delete(approvalId);
        return;
      }
      const optionId = ompPermissionOptionId(pending.params, resolution);
      if (optionId === null) throw new Error(`OMP did not offer a permission option for ${resolution.decision}.`);
      this.rpc.respond(pending.requestId, { outcome: { outcome: 'selected', optionId } });
      this.pendingApprovals.delete(approvalId);
      return;
    }
    if (resolution.decision === 'deny' || resolution.decision === 'cancel') {
      this.rpc.respond(pending.requestId, { action: 'cancel', content: null });
      this.pendingApprovals.delete(approvalId);
      return;
    }
    this.rpc.respond(pending.requestId, { action: 'accept', content: resolution.value ?? {} });
    this.pendingApprovals.delete(approvalId);
  }

  async updateConfig(options: { model?: string; permissionMode?: string }): Promise<void> {
    if (this.externalSessionId === null) return;
    if (options.permissionMode !== undefined) {
      const modeId = options.permissionMode === 'plan' ? 'plan' : 'default';
      await this.rpc.request('session/set_mode', { sessionId: this.externalSessionId, modeId });
      this.modeId = modeId;
      this.permissionMode = options.permissionMode === 'full' ? 'full' : modeId === 'plan' ? 'plan' : 'ask';
    }
    if (options.model !== undefined) {
      await this.rpc.request('session/set_config_option', {
        sessionId: this.externalSessionId,
        configId: 'model',
        value: options.model,
      });
      this.model = options.model;
    }
    this.emit({
      type: 'session.state',
      turnId: this.activeTurnId,
      approvalId: null,
      data: { model: this.model, modeId: this.modeId, permissionMode: this.permissionMode },
    });
  }

  async getConfiguration(): Promise<AgentSessionConfiguration> {
    return {
      model: this.model,
      permissionMode: this.permissionMode,
      models: this.modelOptions,
      permissions: [
        { id: 'ask', label: 'Ask before tools', description: 'Review OMP permission requests.' },
        { id: 'plan', label: 'Plan only', description: 'Use OMP plan mode without workspace edits.' },
        { id: 'full', label: 'Full access', description: 'Automatically allow OMP tool requests without asking.' },
      ],
    };
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    for (const approvalId of this.pendingApprovals.keys()) {
      this.emit({
        type: 'approval.resolved',
        turnId: this.activeTurnId,
        approvalId,
        data: { decision: 'cancel', reason: 'Session closed.' },
      });
    }
    this.pendingApprovals.clear();
    if (this.externalSessionId !== null && this.supportsClose) {
      try {
        await this.rpc.request('session/close', { sessionId: this.externalSessionId });
      } catch {
        // The process is still closed below.
      }
    }
    await this.rpc.close();
  }

  private async runPrompt(turnId: string, text: string): Promise<void> {
    if (this.externalSessionId === null) return;
    try {
      const result = asRecord(await this.rpc.request('session/prompt', {
        sessionId: this.externalSessionId,
        prompt: [{ type: 'text', text }],
      }));
      const stopReason = optionalString(result['stopReason']) ?? 'end_turn';
      this.emit({
        type: stopReason === 'cancelled' ? 'turn.cancelled' : 'turn.completed',
        turnId,
        approvalId: null,
        data: { stopReason },
      });
    } catch (error) {
      this.emit({
        type: 'turn.failed',
        turnId,
        approvalId: null,
        data: { message: error instanceof Error ? error.message : String(error) },
      });
    } finally {
      if (this.activeTurnId === turnId) this.activeTurnId = null;
    }
  }

  private async handleServerRequest(message: JsonRpcRequestMessage): Promise<void> {
    if (SUPPORTED_ACP_REQUESTS[message.method] !== true) {
      this.rpc.respondError(message.id, -32601, `Seevee does not implement ${message.method}.`);
      return;
    }
    if (message.method === 'session/request_permission' && this.permissionMode === 'full') {
      const params = asRecord(message.params);
      const optionId = ompPermissionOptionId(params, { decision: 'allow-session' })
        ?? ompPermissionOptionId(params, { decision: 'allow-once' });
      if (optionId !== null) {
        this.rpc.respond(message.id, { outcome: { outcome: 'selected', optionId } });
        return;
      }
    }
    const approvalId = `approval_${randomUUID()}`;
    const params = asRecord(message.params);
    this.pendingApprovals.set(approvalId, { requestId: message.id, method: message.method, params });
    this.emit({
      type: 'approval.requested',
      turnId: this.activeTurnId,
      approvalId,
      data: {
        provider: 'omp',
        kind: message.method,
        title: optionalString(params['message']) ?? message.method,
        request: sanitizeAgentValue(params),
      },
    });
  }

  private handleNotification(message: JsonRpcNotificationMessage): void {
    if (message.method !== 'session/update') return;
    const params = asRecord(message.params);
    const update = asRecord(params['update']);
    const turnId = this.activeTurnId;
    switch (update['sessionUpdate']) {
      case 'user_message_chunk':
        this.emit({ type: 'message.started', turnId, approvalId: null, data: { role: 'user', content: sanitizeAgentValue(update['content']) } });
        return;
      case 'agent_message_chunk': {
        const content = asRecord(update['content']);
        this.emit({ type: 'message.delta', turnId, approvalId: null, data: { delta: optionalString(content['text']) ?? '' } });
        return;
      }
      case 'agent_thought_chunk': {
        const content = asRecord(update['content']);
        this.emit({ type: 'reasoning.delta', turnId, approvalId: null, data: { delta: optionalString(content['text']) ?? '' } });
        return;
      }
      case 'tool_call':
        this.emit({
          type: 'tool.started',
          turnId,
          approvalId: null,
          data: {
            callId: optionalString(update['toolCallId']),
            name: optionalString(update['name']) ?? 'tool',
            title: optionalString(update['title']) ?? 'Tool call',
            kind: optionalString(update['kind']) ?? 'other',
            status: optionalString(update['status']) ?? 'pending',
            input: sanitizeAgentValue(update['rawInput']),
            locations: sanitizeAgentValue(update['locations']),
          },
        });
        return;
      case 'tool_call_update': {
        const status = optionalString(update['status']);
        this.emit({
          type: status === 'completed' || status === 'failed' ? 'tool.completed' : 'tool.updated',
          turnId,
          approvalId: null,
          data: {
            callId: optionalString(update['toolCallId']),
            status: status ?? 'in_progress',
            output: sanitizeAgentValue(update['rawOutput'] ?? update['content']),
            locations: sanitizeAgentValue(update['locations']),
          },
        });
        return;
      }
      case 'plan':
        this.emit({ type: 'plan.updated', turnId, approvalId: null, data: { entries: sanitizeAgentValue(update['entries']) } });
        return;
      case 'usage_update':
        this.emit({ type: 'usage.updated', turnId, approvalId: null, data: sanitizeAgentValue(update) });
        return;
      case 'current_mode_update':
      case 'config_option_update':
      case 'session_info_update':
        this.emit({ type: 'session.state', turnId, approvalId: null, data: sanitizeAgentValue(update) });
        return;
      default:
        this.emit({ type: 'provider.extra', turnId, approvalId: null, data: { method: message.method, update: sanitizeAgentValue(update) } });
    }
  }

}
