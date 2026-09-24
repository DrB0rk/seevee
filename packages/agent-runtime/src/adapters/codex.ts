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
import { asRecord, optionalNumber, optionalString, sanitizeAgentValue } from '../control/payload.js';
import { seeveeAgentInstructions } from '../control/seevee-agent.js';
import {
  DEFAULT_AGENT_CAPABILITIES,
  type AgentCapabilities,
  type AgentEventInput,
  type AgentPromptResult,
  type AgentProviderDescriptor,
  type AgentSessionConfiguration,
} from '../control/types.js';
import { detectCommand } from './detect-command.js';

const threadResultSchema = z.object({
  thread: z.object({ id: z.string().min(1) }),
  model: z.string().optional(),
});

const turnResultSchema = z.object({
  turn: z.object({
    id: z.string().min(1),
    status: z.string().optional(),
  }),
});

const turnSteerResultSchema = z.object({
  turnId: z.string().min(1),
});

const modelListSchema = z.object({
  data: z.array(z.object({
    id: z.string().min(1),
    model: z.string().min(1),
    displayName: z.string(),
    description: z.string(),
    hidden: z.boolean(),
    isDefault: z.boolean(),
  })),
});

const CODEX_CAPABILITIES: AgentCapabilities = {
  ...DEFAULT_AGENT_CAPABILITIES,
  steering: true,
  subagents: true,
};
const SUPPORTED_APPROVAL_METHODS: Record<string, true> = {
  'item/commandExecution/requestApproval': true,
  'item/fileChange/requestApproval': true,
  'item/permissions/requestApproval': true,
  'item/tool/requestUserInput': true,
  'mcpServer/elicitation/request': true,
};


interface PendingApproval {
  requestId: string | number;
  method: string;
  params: Record<string, unknown>;
}

export class CodexAdapter implements AgentAdapter {
  readonly id = 'codex' as const;
  readonly command = 'codex';

  async detect(): Promise<AgentProviderDescriptor> {
    const detection = await detectCommand(this.command);
    const installed = detection.executablePath !== null;
    const ready = installed && detection.error === null;
    return {
      id: this.id,
      label: 'Codex',
      command: this.command,
      installed,
      status: !installed ? 'not-installed' : ready ? 'ready' : 'error',
      version: detection.version,
      executablePath: detection.executablePath,
      ready,
      capabilities: CODEX_CAPABILITIES,
      message: detection.error ?? (installed ? 'Codex App Server detected.' : null),
    };
  }

  async createSession(options: CreateAdapterSessionOptions): Promise<AdapterSession> {
    const session = new CodexAdapterSession(options);
    await session.initialize();
    return session;
  }
}

class CodexAdapterSession implements AdapterSession {
  readonly capabilities = CODEX_CAPABILITIES;
  externalSessionId: string | null = null;

  private readonly rpc: JsonRpcProcessClient;
  private readonly emit: (event: AgentEventInput) => void;
  private readonly pendingApprovals = new Map<string, PendingApproval>();
  private readonly workspaceRoot: string;
  private readonly signal: AbortSignal;
  private activeTurnId: string | null = null;
  private model: string | null = null;
  private approvalPolicy: 'untrusted' | 'on-request' | 'never' = 'on-request';
  private closed = false;
  private readonly requestedResumeSessionId: string | undefined;

  constructor(options: CreateAdapterSessionOptions) {
    this.workspaceRoot = options.workspaceRoot;
    this.emit = options.emit;
    this.signal = options.signal;
    this.requestedResumeSessionId = options.resumeSessionId;
    this.rpc = new JsonRpcProcessClient({
      command: options.executablePath,
      args: ['app-server', '--stdio'],
      cwd: options.workspaceRoot,
      includeJsonRpcVersion: false,
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
        data: { message: `Codex App Server stopped: ${error?.message ?? 'unknown reason'}` },
      });
    };
    this.signal.addEventListener('abort', () => void this.close(), { once: true });
  }

  async initialize(): Promise<void> {
    await this.rpc.request('initialize', {
      clientInfo: { name: 'seevee', title: 'Seevee Studio', version: '0.1.0' },
      capabilities: null,
    });
    this.rpc.notify('initialized');
    const resumeSessionId = this.requestedResumeSessionId;
    const result = resumeSessionId === undefined
      ? await this.rpc.request('thread/start', {
        cwd: this.workspaceRoot,
        approvalPolicy: this.approvalPolicy,
        sandbox: 'workspace-write',
        developerInstructions: seeveeAgentInstructions(),
      })
      : await this.rpc.request('thread/resume', {
        threadId: resumeSessionId,
        cwd: this.workspaceRoot,
        approvalPolicy: this.approvalPolicy,
        sandbox: 'workspace-write',
        developerInstructions: seeveeAgentInstructions(),
      });
    const parsed = threadResultSchema.parse(result);
    this.externalSessionId = parsed.thread.id;
    this.model = parsed.model ?? null;
  }


  async sendPrompt(options: AdapterPromptOptions): Promise<AgentPromptResult> {
    if (this.externalSessionId === null) throw new Error('Codex thread is not initialized.');
    if (this.activeTurnId !== null) {
      const result = turnSteerResultSchema.parse(await this.rpc.request('turn/steer', {
        threadId: this.externalSessionId,
        expectedTurnId: this.activeTurnId,
        input: [{ type: 'text', text: options.text }],
      }));
      return { turnId: result.turnId, queued: false, mode: 'steered' };
    }
    const result = turnResultSchema.parse(await this.rpc.request('turn/start', {
      threadId: this.externalSessionId,
      input: [{ type: 'text', text: options.text }],
      ...(this.model === null ? {} : { model: this.model }),
      approvalPolicy: this.approvalPolicy,
    }));
    this.activeTurnId = result.turn.id;
    return { turnId: this.activeTurnId, queued: false, mode: 'new-turn' };
  }

  async interrupt(): Promise<void> {
    if (this.externalSessionId === null || this.activeTurnId === null) return;
    await this.rpc.request('turn/interrupt', {
      threadId: this.externalSessionId,
      turnId: this.activeTurnId,
    });
    this.emit({
      type: 'turn.cancelled',
      turnId: this.activeTurnId,
      approvalId: null,
      data: { message: 'Codex turn interrupted by the user.' },
    });
    this.activeTurnId = null;
  }

  async resolveApproval(approvalId: string, resolution: AdapterApprovalResolution): Promise<void> {
    const pending = this.pendingApprovals.get(approvalId);
    if (pending === undefined) throw new Error(`Unknown or resolved Codex approval ${approvalId}.`);
    this.pendingApprovals.delete(approvalId);
    if (resolution.decision === 'cancel') {
      this.rpc.respond(pending.requestId, { outcome: 'cancelled' });
      return;
    }
    if (pending.method === 'item/permissions/requestApproval') {
      const requested = asRecord(pending.params['permissions']);
      this.rpc.respond(pending.requestId, {
        permissions: resolution.decision === 'deny' ? {} : requested,
        scope: resolution.decision === 'allow-session' ? 'session' : 'turn',
      });
      return;
    }
    if (pending.method === 'item/tool/requestUserInput' || pending.method === 'mcpServer/elicitation/request') {
      this.rpc.respond(pending.requestId, resolution.decision === 'deny'
        ? { action: 'decline', content: null }
        : { action: 'accept', content: resolution.value ?? {} });
      return;
    }
    const decision = resolution.decision === 'allow-once'
      ? 'accept'
      : resolution.decision === 'allow-session'
        ? 'acceptForSession'
        : 'decline';
    this.rpc.respond(pending.requestId, { decision });
  }

  async updateConfig(options: { model?: string; permissionMode?: string }): Promise<void> {
    if (options.model !== undefined) this.model = options.model;
    if (options.permissionMode === 'untrusted' || options.permissionMode === 'on-request' || options.permissionMode === 'never') {
      this.approvalPolicy = options.permissionMode;
    }
    this.emit({
      type: 'session.state',
      turnId: this.activeTurnId,
      approvalId: null,
      data: { model: this.model, permissionMode: this.approvalPolicy },
    });
  }

  async getConfiguration(): Promise<AgentSessionConfiguration> {
    const response = modelListSchema.parse(await this.rpc.request('model/list', {
      includeHidden: false,
      limit: 100,
    }));
    return {
      model: this.model,
      permissionMode: this.approvalPolicy,
      models: response.data
        .filter((model) => !model.hidden)
        .map((model) => ({
          id: model.model || model.id,
          label: model.displayName || model.model,
          description: model.description || null,
        })),
      permissions: [
        { id: 'on-request', label: 'Ask when needed', description: 'Request approval for sensitive actions.' },
        { id: 'untrusted', label: 'Ask for untrusted actions', description: 'Use Codex approval escalation rules.' },
        { id: 'never', label: 'Never ask', description: 'Deny actions that require approval.' },
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
    await this.rpc.close();
  }

  private async handleServerRequest(message: JsonRpcRequestMessage): Promise<void> {
    if (SUPPORTED_APPROVAL_METHODS[message.method] !== true) {
      this.rpc.respondError(message.id, -32601, `Seevee does not implement ${message.method}.`);
      return;
    }
    const approvalId = `approval_${randomUUID()}`;
    const params = asRecord(message.params);
    this.pendingApprovals.set(approvalId, { requestId: message.id, method: message.method, params });
    this.emit({
      type: 'approval.requested',
      turnId: optionalString(params['turnId']),
      approvalId,
      data: {
        provider: 'codex',
        kind: message.method,
        title: optionalString(params['reason']) ?? message.method,
        request: sanitizeAgentValue(params),
      },
    });
  }

  private handleNotification(message: JsonRpcNotificationMessage): void {
    const params = asRecord(message.params);
    const turnId = optionalString(params['turnId']);
    switch (message.method) {
      case 'turn/started': {
        const turn = asRecord(params['turn']);
        this.activeTurnId = optionalString(turn['id']);
        return;
      }
      case 'turn/completed': {
        const turn = asRecord(params['turn']);
        this.emit({
          type: turn['status'] === 'failed' ? 'turn.failed' : turn['status'] === 'interrupted' ? 'turn.cancelled' : 'turn.completed',
          turnId,
          approvalId: null,
          data: turn,
        });
        this.activeTurnId = null;
        return;
      }
      case 'item/started':
        this.handleItem('tool.started', params, turnId);
        return;
      case 'item/completed':
        this.handleItem('tool.completed', params, turnId);
        return;
      case 'item/agentMessage/delta':
        this.emit({ type: 'message.delta', turnId, approvalId: null, data: { delta: optionalString(params['delta']) ?? '' } });
        return;
      case 'item/reasoning/summaryTextDelta':
      case 'item/reasoning/textDelta':
        this.emit({ type: 'reasoning.delta', turnId, approvalId: null, data: { delta: optionalString(params['delta']) ?? '' } });
        return;
      case 'item/commandExecution/outputDelta':
      case 'item/fileChange/outputDelta':
        this.emit({
          type: 'tool.updated',
          turnId,
          approvalId: null,
          data: { callId: optionalString(params['itemId']), delta: optionalString(params['delta']) ?? '' },
        });
        return;
      case 'turn/plan/updated':
        this.emit({ type: 'plan.updated', turnId, approvalId: null, data: sanitizeAgentValue(params) });
        return;
      case 'thread/tokenUsage/updated': {
        const tokenUsage = asRecord(params['tokenUsage']);
        const total = asRecord(tokenUsage['total']);
        const last = asRecord(tokenUsage['last']);
        this.emit({
          type: 'usage.updated',
          turnId,
          approvalId: null,
          data: {
            totalTokens: optionalNumber(total['totalTokens']),
            inputTokens: optionalNumber(last['inputTokens']),
            cachedInputTokens: optionalNumber(last['cachedInputTokens']),
            outputTokens: optionalNumber(last['outputTokens']),
            reasoningOutputTokens: optionalNumber(last['reasoningOutputTokens']),
            contextWindow: optionalNumber(tokenUsage['modelContextWindow']),
          },
        });
        return;
      }
      case 'error': {
        const error = asRecord(params['error']);
        this.emit({
          type: 'turn.failed',
          turnId,
          approvalId: null,
          data: { message: optionalString(error['message']) ?? 'Codex reported an error.' },
        });
        return;
      }
      case 'turn/diff/updated':
      case 'warning':
      case 'configWarning':
      case 'thread/status/changed':
      case 'model/rerouted':
        this.emit({ type: 'provider.extra', turnId, approvalId: null, data: { method: message.method, params: sanitizeAgentValue(params) } });
        return;
      default:
        if (message.method.startsWith('item/') || message.method.startsWith('hook/')) {
          this.emit({ type: 'provider.extra', turnId, approvalId: null, data: { method: message.method, params: sanitizeAgentValue(params) } });
        }
    }
  }

  private handleItem(type: 'tool.started' | 'tool.completed', params: Record<string, unknown>, turnId: string | null): void {
    const item = asRecord(params['item']);
    const itemType = optionalString(item['type']) ?? 'item';
    const itemId = optionalString(item['id']) ?? optionalString(params['itemId']);
    if (itemType === 'userMessage') return;
    if (itemType === 'agentMessage') {
      this.emit({
        type: type === 'tool.started' ? 'message.started' : 'message.completed',
        turnId,
        approvalId: null,
        data: { id: itemId, text: optionalString(item['text']) ?? '' },
      });
      return;
    }
    if (itemType === 'reasoning') {
      this.emit({
        type: 'reasoning.delta',
        turnId,
        approvalId: null,
        data: { id: itemId, text: sanitizeAgentValue(item['summary'] ?? item['content']) },
      });
      return;
    }
    if (itemType === 'plan') {
      this.emit({ type: 'plan.updated', turnId, approvalId: null, data: { id: itemId, text: optionalString(item['text']) ?? '' } });
      return;
    }
    this.emit({
      type,
      turnId,
      approvalId: null,
      data: {
        callId: itemId,
        name: itemType,
        kind: itemType === 'commandExecution' ? 'execute' : itemType === 'fileChange' ? 'edit' : 'other',
        status: optionalString(item['status']) ?? (type === 'tool.started' ? 'running' : 'completed'),
        input: sanitizeAgentValue(item['command'] ?? item['changes'] ?? item['arguments'] ?? item['query']),
        output: sanitizeAgentValue(item['aggregatedOutput'] ?? item['result'] ?? item['error']),
        item: sanitizeAgentValue(item),
      },
    });
  }
}
