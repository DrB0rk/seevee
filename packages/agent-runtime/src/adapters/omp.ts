import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import pathModule from 'node:path';
import { z } from 'zod';
import type {
  AdapterApprovalResolution,
  AdapterPromptOptions,
  AdapterSession,
  AgentAdapter,
  CreateAdapterSessionOptions,
} from '../control/adapter.js';
import { CANCEL_CONFIRMATION_TIMEOUT_MS } from '../control/adapter.js';
import {
  JsonRpcProcessClient,
  JsonRpcProcessError,
  jsonRpcErrorDetail,
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

/**
 * ACP methods OMP addresses to the client during a session.
 *
 * `fs/read_text_file` and `fs/write_text_file` are only sent when the client
 * advertises the matching `clientCapabilities.fs` flag; `terminal/create`
 * only when `terminal: true` is advertised (we never advertise it).
 */
const SUPPORTED_ACP_REQUESTS: Record<string, true> = {
  'session/request_permission': true,
  'elicitation/create': true,
  'fs/read_text_file': true,
  'fs/write_text_file': true,
};

/** Seevee permission vocabulary for OMP. Provider-specific by design. */
export const OMP_PERMISSION_MODES = ['ask', 'plan', 'full'] as const;
export type OmpPermissionMode = (typeof OMP_PERMISSION_MODES)[number];

/**
 * The only ACP modes OMP 18.6.1 accepts in `session/set_mode`.
 * Verified live against the binary: every other id (including `full`,
 * `yolo`, `bypass`, `acceptEdits`) is rejected with
 * `-32603 Unsupported ACP mode: <id>`.
 */
export const OMP_ACP_MODES = ['default', 'plan'] as const;
export type OmpAcpMode = (typeof OMP_ACP_MODES)[number];

/**
 * Raised when OMP rejects a call because the requested capability does not
 * exist in its ACP surface (unknown mode id, unknown config option id).
 * Carries the provider's own wording so the UI can explain the failure
 * instead of surfacing a bare "Internal error".
 */
export class OmpProtocolError extends Error {
  readonly method: string;
  readonly provider = 'omp' as const;

  constructor(method: string, requested: string, detail: string) {
    super(`OMP rejected ${method} "${requested}": ${detail}`);
    this.name = 'OmpProtocolError';
    this.method = method;
  }
}

export function ompPermissionMode(value: string): OmpPermissionMode | null {
  return (OMP_PERMISSION_MODES as readonly string[]).includes(value) ? (value as OmpPermissionMode) : null;
}

/** Seevee permission mode -> the ACP mode id OMP must be switched into. */
export function ompAcpModeForPermission(permissionMode: OmpPermissionMode): OmpAcpMode {
  return permissionMode === 'plan' ? 'plan' : 'default';
}


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

/**
 * Writes a file OMP routed to the client via `fs/write_text_file`.
 *
 * Relative paths resolve against the session workspace root. OMP sends
 * absolute paths rooted at the session cwd, so this also serves as the
 * containment check: a write escaping the workspace root is refused rather
 * than silently redirected.
 */
async function writeWorkspaceFile(workspaceRoot: string, path: string, content: string): Promise<void> {
  const root = pathModule.resolve(workspaceRoot);
  const target = pathModule.resolve(root, path);
  const relative = pathModule.relative(root, target);
  if (relative.startsWith('..') || pathModule.isAbsolute(relative)) {
    throw new Error(`Refusing to write outside the workspace: ${path}`);
  }
  await fs.mkdir(pathModule.dirname(target), { recursive: true });
  await fs.writeFile(target, content, 'utf8');
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
  private permissionMode: OmpPermissionMode = 'ask';
  private modelOptions: AgentSelectOption[] = [];
  private closed = false;
  private supportsClose = false;
  /** Resolves once the in-flight turn ends, however it ends. */
  private activeTurnSettled: Promise<void> | null = null;
  private releaseActiveTurn: (() => void) | null = null;
  private readonly requestedResumeSessionId: string | undefined;

  constructor(options: CreateAdapterSessionOptions) {
    this.workspaceRoot = options.workspaceRoot;
    this.emit = options.emit;
    this.signal = options.signal;
    this.requestedResumeSessionId = options.resumeSessionId;
    this.rpc = new JsonRpcProcessClient({
      command: options.executablePath,
      // `write` (not `always-ask`): with `always-ask` OMP *denies* every
      // write/edit outright without ever asking the client, which would make
      // the ask and plan permission modes unable to write at all. `write`
      // auto-approves reads and workspace writes, and still raises
      // `session/request_permission` for `execute` tool calls. Combined with
      // `fs.writeTextFile: true` below it leaves Seevee as the gate for every
      // workspace mutation. Verified against omp 18.6.1.
      args: ['acp', '--approval-mode', 'write', '--append-system-prompt', options.instructions],
      cwd: options.workspaceRoot,
      includeJsonRpcVersion: true,
      requestTimeoutMs: 60_000,
      env: options.env ?? process.env,
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
        // Advertising `writeTextFile` is what makes OMP route every workspace
        // write/edit through `fs/write_text_file` instead of writing the file
        // itself. That request is the client-side permission gate OMP exposes;
        // it is the only permission lever in OMP's ACP surface. Reads stay
        // provider-side (`readTextFile: false`) so the agent keeps full read
        // access without a round trip per file.
        fs: { readTextFile: false, writeTextFile: true },
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

  /**
 * Stops the running turn and resolves once OMP confirms it.
 *
 * `session/cancel` is a notification, so it carries no acknowledgement by
 * itself. The authoritative confirmation is the in-flight `session/prompt`
 * request resolving with `stopReason: "cancelled"` (verified against omp
 * 18.6.1, including while a `session/request_permission` is outstanding).
 * `runPrompt` emits the terminal event from that result, so `interrupt` never
 * announces a cancellation the provider has not made.
 *
 * The wait is bounded by {@link CANCEL_CONFIRMATION_TIMEOUT_MS} so a provider
 * that accepts the cancel and then goes quiet fails loudly instead of leaving
 * the UI's Stop button spinning forever.
 */
  async interrupt(): Promise<void> {
    if (this.externalSessionId === null) return;
    const turnId = this.activeTurnId;
    if (turnId === null) return;
    this.rpc.notify('session/cancel', { sessionId: this.externalSessionId });
    await Promise.race([
      this.activeTurnSettled,
      new Promise<void>((resolve) => { setTimeout(resolve, CANCEL_CONFIRMATION_TIMEOUT_MS).unref?.(); }),
    ]);
    if (this.activeTurnId === turnId) {
      throw new Error(`OMP did not confirm cancellation of turn ${turnId} within ${CANCEL_CONFIRMATION_TIMEOUT_MS}ms.`);
    }
  }

  async resolveApproval(approvalId: string, resolution: AdapterApprovalResolution): Promise<void> {
    const pending = this.pendingApprovals.get(approvalId);
    if (pending === undefined) throw new Error(`Unknown or resolved OMP approval ${approvalId}.`);
    if (pending.method === 'fs/write_text_file') {
      const path = optionalString(pending.params['path']) ?? '(unknown path)';
      const content = optionalString(pending.params['content']) ?? '';
      if (resolution.decision === 'deny' || resolution.decision === 'cancel') {
        this.rpc.respondError(pending.requestId, -32603, 'Write denied by the user.');
        this.pendingApprovals.delete(approvalId);
        return;
      }
      await this.applyApprovedWrite(pending.requestId, path, content);
      this.pendingApprovals.delete(approvalId);
      return;
    }
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

  /**
   * Applies the requested permission mode.
   *
   * OMP has no server-side permission mode: `session/set_mode` accepts only
   * `default` and `plan`, and the only ACP config options are `mode`, `model`
   * and `thinking` (verified against omp 18.6.1). So `ask`, `plan` and `full`
   * are enforced **client-side** by this adapter — see `handleServerRequest` —
   * and the ACP mode id is derived from the Seevee mode rather than being one.
   *
   * A provider rejection is surfaced as {@link OmpProtocolError} instead of
   * being swallowed, and the local state is only advanced once the provider
   * has accepted the call.
   */
  async updateConfig(options: { model?: string; permissionMode?: string }): Promise<void> {
    if (this.externalSessionId === null) return;
    if (options.permissionMode !== undefined) {
      const requested = ompPermissionMode(options.permissionMode);
      if (requested === null) {
        throw new OmpProtocolError(
          'session/set_mode',
          options.permissionMode,
          `known permission modes are ${OMP_PERMISSION_MODES.join(', ')}`,
        );
      }
      const modeId = ompAcpModeForPermission(requested);
      if (modeId !== this.modeId) {
        try {
          await this.rpc.request('session/set_mode', { sessionId: this.externalSessionId, modeId });
        } catch (error) {
          throw this.protocolError('session/set_mode', modeId, error);
        }
        this.modeId = modeId;
      }
      this.permissionMode = requested;
    }
    if (options.model !== undefined) {
      try {
        await this.rpc.request('session/set_config_option', {
          sessionId: this.externalSessionId,
          configId: 'model',
          value: options.model,
        });
      } catch (error) {
        throw this.protocolError('session/set_config_option', 'model', error);
      }
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
        { id: 'ask', label: 'Ask before tools', description: 'Review each tool call and workspace write before it runs.' },
        { id: 'plan', label: 'Plan only', description: 'Read-only OMP plan mode; workspace writes stay blocked.' },
        { id: 'full', label: 'Full access', description: 'Approve every OMP tool call and workspace write without asking.' },
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
    this.activeTurnSettled = new Promise<void>((resolve) => { this.releaseActiveTurn = resolve; });
    try {
      const result = asRecord(await this.rpc.request('session/prompt', {
        sessionId: this.externalSessionId,
        prompt: [{ type: 'text', text }],
      }));
      const stopReason = optionalString(result['stopReason']) ?? 'end_turn';
      // The single source of truth for a turn's terminal event. `interrupt`
      // deliberately does not emit one: it awaits this result instead.
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
      // Releases `interrupt()`, which waits here rather than assuming the
      // notification it sent actually stopped anything.
      this.releaseActiveTurn?.();
      this.releaseActiveTurn = null;
      this.activeTurnSettled = null;
    }
  }

  /**
   * Enforces Seevee's permission mode for OMP.
   *
   * OMP exposes no server-side permission setting, so this client is the gate.
   * Two request kinds are permission-bearing:
   *
   * - `session/request_permission` — OMP asks before an `execute` tool call.
   *   `full` answers it immediately with an allow option; `ask`/`plan` raise
   *   an approval in the UI.
   * - `fs/write_text_file` — reached because `initialize` advertises
   *   `fs.writeTextFile`, which makes OMP route *every* workspace write/edit
   *   through the client. `full` performs the write; `ask`/`plan` raise an
   *   approval and deny with a JSON-RPC error, which OMP surfaces to the model
   *   as "Write denied by the user."
   *
   * `plan` additionally runs the session in OMP's `plan` ACP mode (read-only),
   * so plan mode blocks on both layers.
   */
  private async handleServerRequest(message: JsonRpcRequestMessage): Promise<void> {
    if (SUPPORTED_ACP_REQUESTS[message.method] !== true) {
      this.rpc.respondError(message.id, -32601, `Seevee does not implement ${message.method}.`);
      return;
    }
    const params = asRecord(message.params);
    const unattended = this.permissionMode === 'full';
    if (message.method === 'fs/read_text_file') {
      // Reads stay provider-side: `readTextFile` is advertised as false, so
      // OMP should never send this. Answering it rather than erroring keeps a
      // future OMP release from wedging the session on an unexpected read.
      this.rpc.respondError(message.id, -32601, 'Seevee does not serve ACP file reads.');
      return;
    }
    if (unattended && message.method === 'session/request_permission') {
      const optionId = ompPermissionOptionId(params, { decision: 'allow-session' })
        ?? ompPermissionOptionId(params, { decision: 'allow-once' });
      if (optionId !== null) {
        this.rpc.respond(message.id, { outcome: { outcome: 'selected', optionId } });
        return;
      }
    }
    if (message.method === 'fs/write_text_file') {
      const path = optionalString(params['path']) ?? '(unknown path)';
      const content = optionalString(params['content']) ?? '';
      if (unattended) {
        await this.applyApprovedWrite(message.id, path, content);
        return;
      }
      this.raiseApproval(message.id, 'fs/write_text_file', params, {
        provider: 'omp',
        kind: 'fs/write_text_file',
        title: `Write ${path}`,
        request: sanitizeAgentValue(params),
      });
      return;
    }
    this.raiseApproval(message.id, message.method, params, {
      provider: 'omp',
      kind: message.method,
      title: optionalString(params['message']) ?? message.method,
      request: sanitizeAgentValue(params),
    });
  }

  private raiseApproval(
    requestId: string | number,
    method: string,
    params: Record<string, unknown>,
    data: Record<string, unknown>,
  ): void {
    const approvalId = `approval_${randomUUID()}`;
    this.pendingApprovals.set(approvalId, { requestId, method, params });
    this.emit({
      type: 'approval.requested',
      turnId: this.activeTurnId,
      approvalId,
      data,
    });
  }

  /**
 * Performs a write OMP routed to the client via `fs/write_text_file`, replying
 * with a JSON-RPC error when it fails so OMP reports the refusal to the model
 * rather than treating the write as done.
 */
  private async applyApprovedWrite(requestId: string | number, path: string, content: string): Promise<void> {
    try {
      await writeWorkspaceFile(this.workspaceRoot, path, content);
      this.rpc.respond(requestId, {});
    } catch (error) {
      this.rpc.respondError(
        requestId,
        -32603,
        error instanceof Error ? error.message : String(error),
      );
    }
  }

  private protocolError(method: string, requested: string, error: unknown): Error {
    if (error instanceof JsonRpcProcessError) {
      const detail = jsonRpcErrorDetail({ code: error.code, message: error.message, data: error.data });
      if (detail !== null) return new OmpProtocolError(method, requested, detail);
      return new OmpProtocolError(method, requested, `provider error ${error.code}`);
    }
    return error instanceof Error ? error : new Error(String(error));
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
