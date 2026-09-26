import { randomUUID } from 'node:crypto';
import {
  query as startQuery,
  type CanUseTool,
  type PermissionMode,
  type PermissionResult,
  type PermissionUpdate,
  type Query,
  type SDKUserMessage,
} from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';
import type {
  AdapterApprovalResolution,
  AdapterPromptOptions,
  AdapterSession,
  AgentAdapter,
  CreateAdapterSessionOptions,
} from '../control/adapter.js';
import { asRecord, optionalNumber, optionalString, sanitizeAgentValue } from '../control/payload.js';
import {
  DEFAULT_AGENT_CAPABILITIES,
  type AgentCapabilities,
  type AgentEventInput,
  type AgentPromptResult,
  type AgentProviderDescriptor,
  type AgentSessionConfiguration,
} from '../control/types.js';
import { detectCommand, runCommand } from './detect-command.js';

const authStatusSchema = z.object({
  loggedIn: z.boolean(),
  authMethod: z.string().optional(),
  apiProvider: z.string().optional(),
});

const CLAUDE_CAPABILITIES: AgentCapabilities = {
  ...DEFAULT_AGENT_CAPABILITIES,
  steering: true,
  subagents: true,
};

interface PendingApproval {
  resolve: (result: PermissionResult) => void;
  toolName: string;
  input: Record<string, unknown>;
  suggestions: PermissionUpdate[];
  title: string;
}

class AsyncMessageQueue<T> implements AsyncIterable<T> {
  private readonly values: T[] = [];
  private readonly pullers: Array<(result: IteratorResult<T>) => void> = [];
  private ended = false;
  private failure: Error | null = null;

  push(value: T): void {
    if (this.ended) throw new Error('Cannot write to a closed Claude message queue.');
    const puller = this.pullers.shift();
    if (puller !== undefined) puller({ value, done: false });
    else this.values.push(value);
  }

  end(): void {
    if (this.ended) return;
    this.ended = true;
    for (const puller of this.pullers.splice(0)) puller({ value: undefined, done: true });
  }

  fail(error: Error): void {
    if (this.ended) return;
    this.failure = error;
    this.ended = true;
    for (const puller of this.pullers.splice(0)) puller({ value: undefined, done: true });
  }

  [Symbol.asyncIterator](): AsyncIterator<T> {
    return {
      next: async () => {
        if (this.failure !== null) throw this.failure;
        const value = this.values.shift();
        if (value !== undefined) return { value, done: false };
        if (this.ended) return { value: undefined, done: true };
        return new Promise<IteratorResult<T>>((resolve) => this.pullers.push(resolve));
      },
    };
  }
}

export class ClaudeCodeAdapter implements AgentAdapter {
  readonly id = 'claude-code' as const;
  readonly command = 'claude';

  async detect(): Promise<AgentProviderDescriptor> {
    const detection = await detectCommand(this.command);
    const installed = detection.executablePath !== null;
    if (!installed || detection.executablePath === null) {
      return {
        id: this.id,
        label: 'Claude Code',
        command: this.command,
        installed: false,
        status: 'not-installed',
        version: null,
        executablePath: null,
        ready: false,
        capabilities: CLAUDE_CAPABILITIES,
        message: null,
      };
    }
    try {
      const authResult = await runCommand(detection.executablePath, ['auth', 'status', '--json']);
      const auth = authStatusSchema.parse(JSON.parse(authResult.stdout));
      const ready = auth.loggedIn && detection.error === null;
      return {
        id: this.id,
        label: 'Claude Code',
        command: this.command,
        installed: true,
        status: ready ? 'ready' : 'installed',
        version: detection.version,
        executablePath: detection.executablePath,
        ready,
        capabilities: CLAUDE_CAPABILITIES,
        message: ready ? 'Claude Code is authenticated.' : 'Claude Code is installed but is not authenticated.',
      };
    } catch (error) {
      return {
        id: this.id,
        label: 'Claude Code',
        command: this.command,
        installed: true,
        status: 'error',
        version: detection.version,
        executablePath: detection.executablePath,
        ready: false,
        capabilities: CLAUDE_CAPABILITIES,
        message: error instanceof Error ? error.message : String(error),
      };
    }
  }

  async createSession(options: CreateAdapterSessionOptions): Promise<AdapterSession> {
    return new ClaudeAdapterSession(options);
  }
}

class ClaudeAdapterSession implements AdapterSession {
  readonly capabilities = CLAUDE_CAPABILITIES;
  externalSessionId: string | null;

  private readonly inputQueue = new AsyncMessageQueue<SDKUserMessage>();
  private readonly emit: (event: AgentEventInput) => void;
  private readonly pendingApprovals = new Map<string, PendingApproval>();
  private readonly controller = new AbortController();
  private readonly query: Query;
  private readonly signal: AbortSignal;
  private activeTurnId: string | null = null;
  private model: string | null = null;
  private permissionMode: PermissionMode = 'default';
  private closed = false;

  constructor(options: CreateAdapterSessionOptions) {
    this.emit = options.emit;
    this.signal = options.signal;
    this.externalSessionId = options.resumeSessionId ?? null;
    const canUseTool: CanUseTool = async (toolName, input, approvalOptions) => {
      if (this.closed || this.controller.signal.aborted) {
        return { behavior: 'deny', message: 'Seevee session is closed.' };
      }
      const approvalId = `approval_${randomUUID()}`;
      return new Promise<PermissionResult>((resolve) => {
        this.pendingApprovals.set(approvalId, {
          resolve,
          toolName,
          input,
          suggestions: approvalOptions.suggestions ?? [],
          title: approvalOptions.title ?? `Allow ${toolName}?`,
        });
        this.emit({
          type: 'approval.requested',
          turnId: this.activeTurnId,
          approvalId,
          data: {
            provider: 'claude-code',
            kind: 'tool_permission',
            title: approvalOptions.title ?? `Allow ${toolName}?`,
            description: approvalOptions.description,
            toolName,
            input: sanitizeAgentValue(input),
            blockedPath: approvalOptions.blockedPath,
            canPersist: approvalOptions.suggestions !== undefined && approvalOptions.suggestions.length > 0,
          },
        });
      });
    };
    this.query = startQuery({
      prompt: this.inputQueue,
      options: {
        cwd: options.workspaceRoot,
        pathToClaudeCodeExecutable: options.executablePath,
        systemPrompt: { type: 'preset', preset: 'claude_code', append: options.instructions },
        includePartialMessages: true,
        forwardSubagentText: true,
        includeHookEvents: true,
        permissionPrompts: 'host',
        permissionMode: this.permissionMode,
        canUseTool,
        ...(options.resumeSessionId === undefined ? {} : { resume: options.resumeSessionId }),
        abortController: this.controller,
      },
    });
    this.signal.addEventListener('abort', () => void this.close(), { once: true });
    void this.pump();
  }

  async sendPrompt(options: AdapterPromptOptions): Promise<AgentPromptResult> {
    const turnId = `claude_turn_${randomUUID()}`;
    const queued = this.activeTurnId !== null;
    this.activeTurnId = turnId;
    const message: SDKUserMessage = {
      type: 'user',
      uuid: randomUUID(),
      session_id: this.externalSessionId ?? undefined,
      message: { role: 'user', content: options.text },
      parent_tool_use_id: null,
      origin: { kind: 'human' },
    };
    this.inputQueue.push(message);
    return { turnId, queued, mode: queued ? 'queued' : 'new-turn' };
  }

  async interrupt(): Promise<void> {
    if (this.activeTurnId === null) return;
    const receipt = await this.query.interrupt();
    this.emit({
      type: 'turn.cancelled',
      turnId: this.activeTurnId,
      approvalId: null,
      data: { stillQueued: receipt?.still_queued ?? [] },
    });
  }

  async resolveApproval(approvalId: string, resolution: AdapterApprovalResolution): Promise<void> {
    const pending = this.pendingApprovals.get(approvalId);
    if (pending === undefined) throw new Error(`Unknown or resolved Claude approval ${approvalId}.`);
    this.pendingApprovals.delete(approvalId);
    if (resolution.decision === 'deny' || resolution.decision === 'cancel') {
      pending.resolve({
        behavior: 'deny',
        message: resolution.message ?? 'The user denied this tool call.',
        ...(resolution.decision === 'cancel' ? { interrupt: true } : {}),
      });
      return;
    }
    pending.resolve({
      behavior: 'allow',
      ...(resolution.decision === 'allow-session' && pending.suggestions.length > 0
        ? { updatedPermissions: pending.suggestions }
        : {}),
    });
  }

  async updateConfig(options: { model?: string; permissionMode?: string }): Promise<void> {
    if (options.model !== undefined) {
      await this.query.setModel(options.model);
      this.model = options.model;
    }
    if (options.permissionMode !== undefined) {
      const mode = options.permissionMode as PermissionMode;
      await this.query.setPermissionMode(mode);
      this.permissionMode = mode;
    }
    this.emit({
      type: 'session.state',
      turnId: this.activeTurnId,
      approvalId: null,
      data: { model: this.model, permissionMode: this.permissionMode },
    });
  }

  async getConfiguration(): Promise<AgentSessionConfiguration> {
    const models = await this.query.supportedModels();
    return {
      model: this.model,
      permissionMode: this.permissionMode,
      models: models.map((model) => ({
        id: model.value,
        label: model.displayName,
        description: model.description,
      })),
      permissions: [
        { id: 'default', label: 'Ask before tools', description: 'Review each permission request.' },
        { id: 'acceptEdits', label: 'Accept file edits', description: 'Automatically approve file edits.' },
        { id: 'auto', label: 'Automatic approval', description: 'Use the provider approval classifier.' },
        { id: 'plan', label: 'Plan only', description: 'Do not modify the workspace.' },
        { id: 'dontAsk', label: 'Deny prompts', description: 'Deny actions that require approval.' },
      ],
    };
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    for (const pending of this.pendingApprovals.values()) {
      pending.resolve({ behavior: 'deny', message: 'Seevee session closed.', interrupt: true });
    }
    this.pendingApprovals.clear();
    this.inputQueue.end();
    this.query.close();
    this.controller.abort();
  }

  private async pump(): Promise<void> {
    try {
      for await (const message of this.query) {
        this.handleMessage(message);
      }
    } catch (error) {
      if (!this.closed) {
        this.emit({
          type: 'error',
          turnId: this.activeTurnId,
          approvalId: null,
          data: { message: error instanceof Error ? error.message : String(error) },
        });
      }
    }
  }

  private handleMessage(message: unknown): void {
    const record = asRecord(message);
    const type = optionalString(record['type']);
    switch (type) {
      case 'stream_event':
        this.handleStreamEvent(asRecord(record['event']));
        return;
      case 'assistant':
        this.handleAssistantMessage(record);
        return;
      case 'user':
        this.handleToolResult(record);
        return;
      case 'result':
        this.handleResult(record);
        return;
      case 'system':
        this.handleSystemMessage(record);
        return;
      case 'task_started':
      case 'task_progress':
      case 'task_notification':
      case 'task_updated':
        this.emit({ type: 'subactivity.updated', turnId: this.activeTurnId, approvalId: null, data: sanitizeAgentValue(record) });
        return;
      case 'hook_started':
      case 'hook_progress':
      case 'hook_response':
      case 'rate_limit_event':
      case 'api_retry':
        this.emit({ type: 'provider.extra', turnId: this.activeTurnId, approvalId: null, data: sanitizeAgentValue(record) });
        return;
      default:
        if (type !== null) {
          this.emit({ type: 'provider.extra', turnId: this.activeTurnId, approvalId: null, data: sanitizeAgentValue(record) });
        }
    }
  }

  private handleStreamEvent(event: Record<string, unknown>): void {
    const eventType = optionalString(event['type']);
    if (eventType === 'content_block_start') {
      const block = asRecord(event['content_block']);
      if (block['type'] === 'tool_use') {
        this.emit({
          type: 'tool.started',
          turnId: this.activeTurnId,
          approvalId: null,
          data: {
            callId: optionalString(block['id']),
            name: optionalString(block['name']) ?? 'tool',
            kind: 'other',
            status: 'pending',
            input: sanitizeAgentValue(block['input']),
          },
        });
      }
      return;
    }
    if (eventType !== 'content_block_delta') return;
    const delta = asRecord(event['delta']);
    const deltaType = optionalString(delta['type']);
    if (deltaType === 'text_delta') {
      this.emit({ type: 'message.delta', turnId: this.activeTurnId, approvalId: null, data: { delta: optionalString(delta['text']) ?? '' } });
    } else if (deltaType === 'thinking_delta') {
      this.emit({ type: 'reasoning.delta', turnId: this.activeTurnId, approvalId: null, data: { delta: optionalString(delta['thinking']) ?? '' } });
    } else if (deltaType === 'input_json_delta') {
      this.emit({
        type: 'tool.updated',
        turnId: this.activeTurnId,
        approvalId: null,
        data: { callId: optionalString(event['index']) === null ? null : String(event['index']), partialJson: optionalString(delta['partial_json']) ?? '' },
      });
    }
  }

  private handleAssistantMessage(record: Record<string, unknown>): void {
    const message = asRecord(record['message']);
    const content = Array.isArray(message['content']) ? message['content'] : [];
    let text = '';
    for (const rawBlock of content) {
      const block = asRecord(rawBlock);
      if (block['type'] === 'text') text += optionalString(block['text']) ?? '';
      if (block['type'] === 'tool_use') {
        this.emit({
          type: 'tool.updated',
          turnId: this.activeTurnId,
          approvalId: null,
          data: {
            callId: optionalString(block['id']),
            name: optionalString(block['name']) ?? 'tool',
            status: 'running',
            input: sanitizeAgentValue(block['input']),
          },
        });
      }
    }
    if (text.length > 0) {
      this.emit({ type: 'message.completed', turnId: this.activeTurnId, approvalId: null, data: { text } });
    }
  }

  private handleToolResult(record: Record<string, unknown>): void {
    const message = asRecord(record['message']);
    const content = Array.isArray(message['content']) ? message['content'] : [];
    for (const rawBlock of content) {
      const block = asRecord(rawBlock);
      if (block['type'] !== 'tool_result') continue;
      this.emit({
        type: 'tool.completed',
        turnId: this.activeTurnId,
        approvalId: null,
        data: {
          callId: optionalString(block['tool_use_id']),
          status: block['is_error'] === true ? 'failed' : 'completed',
          output: sanitizeAgentValue(block['content'] ?? record['tool_use_result']),
        },
      });
    }
  }

  private handleResult(record: Record<string, unknown>): void {
    const turnId = optionalString(record['user_message_uuid']) === null
      ? this.activeTurnId
      : String(record['user_message_uuid']);
    const isError = record['is_error'] === true || optionalString(record['subtype'])?.startsWith('error_') === true;
    this.emit({
      type: isError ? 'turn.failed' : 'turn.completed',
      turnId,
      approvalId: null,
      data: {
        subtype: optionalString(record['subtype']),
        result: sanitizeAgentValue(record['result']),
        errors: sanitizeAgentValue(record['errors']),
        usage: sanitizeAgentValue(record['usage']),
        cost: optionalNumber(record['total_cost_usd']),
      },
    });
    const usage = asRecord(record['usage']);
    const inputTokens = optionalNumber(usage['input_tokens']) ?? optionalNumber(usage['inputTokens']);
    const outputTokens = optionalNumber(usage['output_tokens']) ?? optionalNumber(usage['outputTokens']);
    this.emit({
      type: 'usage.updated',
      turnId,
      approvalId: null,
      data: {
        totalTokens: inputTokens === null || outputTokens === null ? null : inputTokens + outputTokens,
        inputTokens,
        cachedInputTokens: optionalNumber(usage['cache_read_input_tokens']) ?? optionalNumber(usage['cachedInputTokens']),
        outputTokens,
        cost: optionalNumber(record['total_cost_usd']),
      },
    });
    if (this.activeTurnId === turnId) this.activeTurnId = null;
  }

  private handleSystemMessage(record: Record<string, unknown>): void {
    if (record['subtype'] === 'init') {
      this.externalSessionId = optionalString(record['session_id']) ?? this.externalSessionId;
      this.model = optionalString(record['model']);
      this.emit({
        type: 'session.state',
        turnId: this.activeTurnId,
        approvalId: null,
        data: {
          model: this.model,
          tools: sanitizeAgentValue(record['tools']),
          mcpServers: sanitizeAgentValue(record['mcp_servers']),
          plugins: sanitizeAgentValue(record['plugins']),
          capabilities: sanitizeAgentValue(record['capabilities']),
        },
      });
      return;
    }
    if (record['subtype'] === 'api_retry' || record['subtype'] === 'rate_limit') {
      this.emit({ type: 'subactivity.updated', turnId: this.activeTurnId, approvalId: null, data: sanitizeAgentValue(record) });
    }
  }
}
