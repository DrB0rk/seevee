import net from 'node:net';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { Socket } from 'node:net';
import type { JsonRpcIncomingMessage } from '../../src/control/json-rpc.js';

/**
 * A scripted stand-in for `omp acp`, served on a Unix socket.
 *
 * It speaks the subset of ACP the OMP adapter uses — `initialize`,
 * `session/new`, `session/load`, `session/set_mode`,
 * `session/set_config_option`, `session/prompt`, `session/cancel`,
 * `session/close` — and can inject server requests
 * (`session/request_permission`, `fs/write_text_file`) into the adapter.
 *
 * Tests spawn the adapter against `fake-acp-proxy.mjs`, which relays to this
 * peer, so the bytes under assertion are the adapter's real wire traffic.
 *
 * `session/set_mode` and `session/set_config_option` validate ids against the
 * sets the real omp 18.6.1 binary accepts, so a regression that reintroduces
 * `set_mode('full')` fails here exactly as it fails against the provider.
 */

/** The only mode ids the real binary accepts in `session/set_mode`. */
export const REAL_ACP_MODE_IDS = ['default', 'plan'] as const;
/** The only config option ids `session/new` advertises. */
export const REAL_ACP_CONFIG_OPTION_IDS = ['mode', 'model', 'thinking'] as const;

export interface FakePeerOptions {
  allowedModeIds?: readonly string[];
  allowedConfigIds?: readonly string[];
  sessionId?: string;
  models?: string[];
  /**
   * Which provider's method names to answer. `acp` (default) serves OMP's
   * `session/*` surface; `codex` serves `thread/*` and `turn/*`.
   */
  dialect?: 'acp' | 'codex';
  /** Thread id `thread/start` reports under the `codex` dialect. */
  threadId?: string;
  /** Turn id `turn/start` reports under the `codex` dialect. */
  turnId?: string;
}

export interface ServerRequestRecord {
  id: string | number;
  method: string;
  params: Record<string, unknown>;
}

export interface PeerResponse {
  id: string | number;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

interface ReceivedMessage {
  method: string;
  params: Record<string, unknown> | undefined;
  id?: string | number;
}

const PROXY = new URL('./fake-acp-proxy.mjs', import.meta.url).pathname;

/**
 * Minimal typed `Promise.withResolvers`, which the ES2022 lib in this package's
 * tsconfig does not declare. Node 20+ provides it at runtime.
 */
function deferred<T>(): { promise: Promise<T>; resolve: (value: T | PromiseLike<T>) => void; reject: (reason?: unknown) => void } {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

export class FakeOmpPeer {
  readonly received: ReceivedMessage[] = [];
  readonly serverRequests: ServerRequestRecord[] = [];
  readonly prompts: Record<string, unknown>[] = [];
  readonly responses: PeerResponse[] = [];

  /** When true, `session/cancel` is recorded but the prompt is never resolved. */
  ignoreCancel = false;
  /** `stopReason` an open prompt resolves with once cancelled. */
  cancelStopReason = 'cancelled';
  /** `stopReason` a prompt resolves with when it is not cancelled. */
  normalStopReason = 'end_turn';

  private readonly server: net.Server;
  private readonly socketPath: string;
  private readonly buffers = new Map<Socket, string>();
  private readonly pending = new Map<string | number, (message: PeerResponse) => void>();
  private readonly openPrompts: { id: string | number }[] = [];
  private readonly responseWaiters: { id: string | number; resolve: (response: PeerResponse) => void }[] = [];
  private readonly allowedModeIds: readonly string[];
  private readonly allowedConfigIds: readonly string[];
  private readonly sessionId: string;
  private readonly models: string[];
  private readonly dialect: 'acp' | 'codex';
  private readonly threadId: string;
  private readonly turnId: string;
  private nextRequestId = 1;

  private constructor(options: FakePeerOptions) {
    this.allowedModeIds = options.allowedModeIds ?? REAL_ACP_MODE_IDS;
    this.allowedConfigIds = options.allowedConfigIds ?? REAL_ACP_CONFIG_OPTION_IDS;
    this.sessionId = options.sessionId ?? 'omp-fake-session';
    this.models = options.models ?? ['fake/model-a', 'fake/model-b'];
    this.dialect = options.dialect ?? 'acp';
    this.threadId = options.threadId ?? 'thread-fake';
    this.turnId = options.turnId ?? 'turn-fake';
    this.socketPath = path.join(os.tmpdir(), `seevee-acp-peer-${process.pid}-${Math.random().toString(36).slice(2)}.sock`);
    this.server = net.createServer((socket) => this.attach(socket));
  }

  /** Starts a peer and resolves once it is accepting connections. */
  static async start(options: FakePeerOptions = {}): Promise<FakeOmpPeer> {
    const peer = new FakeOmpPeer(options);
    const { promise, resolve, reject } = deferred<void>();
    peer.server.once('error', reject);
    peer.server.listen(peer.socketPath, () => resolve());
    return peer;
  }

  /**
   * Writes an executable shim the adapter can spawn in place of `omp`, so its
   * real provider process is the proxy connected to this peer.
   */
  async writeShim(dir: string): Promise<string> {
    const file = path.join(dir, 'omp-fake');
    await fs.writeFile(file, `#!/bin/sh\nexec ${JSON.stringify(process.execPath)} ${JSON.stringify(PROXY)} "$@"\n`, { mode: 0o755 });
    return file;
  }

  /** Env that points the spawned proxy at this peer. */
  get proxyEnv(): NodeJS.ProcessEnv {
    return { ...process.env, SEEVEE_ACP_SOCKET: this.socketPath };
  }

  request(method: string, params: Record<string, unknown>): Promise<PeerResponse> {
    const id = this.nextRequestId++;
    const { promise, resolve } = deferred<PeerResponse>();
    this.pending.set(id, resolve);
    this.send({ jsonrpc: '2.0', id, method, params });
    return promise;
  }

  /** Sends a notification (no id, no response), as ACP cancel does. */
  notify(method: string, params: Record<string, unknown>): void {
    this.send({ jsonrpc: '2.0', method, params });
  }

  /** Pushes a server->client request to the adapter under test. */
  pushRequest(method: string, params: Record<string, unknown>): string | number {
    const id = `srv_${this.nextRequestId++}`;
    this.serverRequests.push({ id, method, params });
    this.send({ jsonrpc: '2.0', id, method, params });
    return id;
  }

  /** Pushes a `session/update` notification to the adapter. */
  pushUpdate(update: Record<string, unknown>): void {
    this.notify('session/update', { sessionId: this.sessionId, update });
  }

  /** The response the adapter sent for a given server-request id. */
  responseFor(id: string | number): PeerResponse | undefined {
    return this.responses.find((entry) => entry.id === id);
  }

  /** Resolves once the adapter answers a pushed server request. */
  waitForResponse(id: string | number, timeoutMs = 5_000): Promise<PeerResponse> {
    const existing = this.responseFor(id);
    if (existing !== undefined) return Promise.resolve(existing);
    const { promise, resolve, reject } = deferred<PeerResponse>();
    const deadline = setTimeout(() => reject(new Error(`timed out waiting for a response to ${id}`)), timeoutMs);
    this.responseWaiters.push({
      id,
      resolve: (response) => { clearTimeout(deadline); resolve(response); },
    });
    return promise;
  }

  /** Resolves once the adapter calls `method` on the peer. */
  waitForCall(method: string, timeoutMs = 5_000): Promise<void> {
    if (this.called(method)) return Promise.resolve();
    const { promise, resolve, reject } = deferred<void>();
    const deadline = setTimeout(() => reject(new Error(`timed out waiting for ${method}`)), timeoutMs);
    const poll = (): void => {
      if (this.called(method)) {
        clearTimeout(deadline);
        resolve();
        return;
      }
      setImmediate(poll);
    };
    poll();
    return promise;
  }

  /**
   * Applies a `session/cancel` the peer withheld via `ignoreCancel`, resolving
   * every open prompt the way the real provider does.
   */
  releaseCancel(): void {
    this.ignoreCancel = false;
    this.applyCancel();
  }

  /** Methods the adapter called, in order. */
  called(method: string): boolean {
    return this.received.some((entry) => entry.method === method);
  }

  /** Params of the first call to `method`, if any. */
  paramsFor(method: string): Record<string, unknown> | undefined {
    return this.received.find((entry) => entry.method === method)?.params;
  }

  /** Resolves every open prompt with the normal (uncancelled) stop reason. */
  finishNormal(): void {
    const stopReason = this.normalStopReason;
    for (const entry of this.openPrompts.splice(0)) this.resolvePrompt(entry.id, stopReason);
  }

  /**
   * Ends the open turn the way Codex does: a `turn/completed` notification
   * whose `turn.status` carries the outcome.
   */
  completeTurn(status: 'completed' | 'interrupted' | 'failed'): void {
    this.openPrompts.splice(0);
    this.notify('turn/completed', {
      threadId: this.threadId,
      turnId: this.turnId,
      turn: { id: this.turnId, status },
    });
  }

  async close(): Promise<void> {
    await new Promise<void>((resolve) => { this.server.close(() => resolve()); });
    await fs.rm(this.socketPath, { force: true });
  }

  private attach(socket: Socket): void {
    socket.setEncoding('utf8');
    this.buffers.set(socket, '');
    socket.on('data', (chunk: string) => {
      const buffered = `${this.buffers.get(socket) ?? ''}${chunk}`;
      const lines = buffered.split('\n');
      this.buffers.set(socket, lines.pop() ?? '');
      for (const line of lines) this.onLine(line);
    });
  }

  private write(socket: Socket | null, message: JsonRpcIncomingMessage): void {
    if (socket === null || socket.destroyed) return;
    socket.write(`${JSON.stringify(message)}\n`);
  }

  private send(message: JsonRpcIncomingMessage): void {
    for (const socket of this.buffers.keys()) this.write(socket, message);
  }

  private resolvePrompt(id: string | number, stopReason: string): void {
    // The prompt was issued by the adapter, so the answer must go back over the
    // wire; there is no test-side waiter for it.
    this.ok(id, { stopReason });
  }

  private onLine(line: string): void {
    if (line.trim().length === 0) return;
    const message = JSON.parse(line) as {
      id?: string | number;
      method?: string;
      params?: Record<string, unknown>;
      result?: unknown;
      error?: { code: number; message: string; data?: unknown };
    };
    if (message.method !== undefined) {
      this.received.push({
        method: message.method,
        params: message.params,
        ...(message.id === undefined ? {} : { id: message.id }),
      });
      if (message.id !== undefined) this.serve(message.method, message.params ?? {}, message.id);
      return;
    }
    if (message.id === undefined) return;
    const response: PeerResponse = {
      id: message.id,
      ...(message.result === undefined ? {} : { result: message.result }),
      ...(message.error === undefined ? {} : { error: message.error }),
    };
    this.responses.push(response);
    for (const waiter of this.responseWaiters.filter((entry) => entry.id === message.id)) {
      this.responseWaiters.splice(this.responseWaiters.indexOf(waiter), 1);
      waiter.resolve(response);
    }
    const waiter = this.pending.get(message.id);
    if (waiter === undefined) return;
    this.pending.delete(message.id);
    waiter(response);
  }

  private serve(method: string, params: Record<string, unknown>, id: string | number): void {
    switch (method) {
      case 'initialize':
        this.ok(id, {
          protocolVersion: 1,
          agentInfo: { name: 'omp', version: '18.6.1-fake' },
          agentCapabilities: { sessionCapabilities: { close: {} } },
        });
        return;
      case 'session/new':
      case 'session/load':
        this.ok(id, {
          sessionId: this.sessionId,
          modes: { availableModes: [{ id: 'default' }, { id: 'plan' }], currentModeId: 'default' },
          configOptions: [
            {
              id: 'mode',
              name: 'Mode',
              currentValue: 'default',
              options: [{ value: 'default' }, { value: 'plan' }],
            },
            {
              id: 'model',
              name: 'Model',
              currentValue: this.models[0] ?? null,
              options: this.models.map((value) => ({ value, name: value })),
            },
          ],
        });
        return;
      case 'session/set_mode': {
        const modeId = String(params['modeId'] ?? '');
        // Mirrors the real binary: an unknown mode is a -32603 carrying the
        // actionable text in `data.details`, not a protocol-level error.
        if (this.allowedModeIds.includes(modeId)) {
          this.ok(id, {});
          return;
        }
        this.fail(id, {
          code: -32603,
          message: 'Internal error',
          data: { details: `Unsupported ACP mode: ${modeId}` },
        });
        return;
      }
      case 'session/set_config_option': {
        const configId = String(params['configId'] ?? '');
        if (this.allowedConfigIds.includes(configId)) {
          this.ok(id, {});
          return;
        }
        this.fail(id, {
          code: -32603,
          message: 'Internal error',
          data: { details: `Unknown ACP config option: ${configId}` },
        });
        return;
      }
      case 'session/prompt':
        this.prompts.push(params);
        this.openPrompts.push({ id });
        return;
      case 'session/cancel':
        // A notification: ACP cancel carries no id, so there is nothing to answer.
        if (!this.ignoreCancel) this.applyCancel();
        return;
      case 'session/close':
        this.ok(id, {});
        return;
      case 'thread/start':
      case 'thread/resume':
        this.ok(id, { thread: { id: this.threadId }, model: this.models[0] ?? null });
        return;
      case 'model/list':
        this.ok(id, {
          data: this.models.map((model, index) => ({
            id: model,
            model,
            displayName: `Fake ${index + 1}`,
            description: 'fake model',
            hidden: false,
            isDefault: index === 0,
          })),
        });
        return;
      case 'turn/start':
        // The turn is accepted immediately but stays open: only `turn/completed`
        // ends it, which is exactly the confirmation `interrupt` must wait for.
        this.prompts.push(params);
        this.ok(id, { turn: { id: this.turnId, status: 'in_progress' } });
        return;
      case 'turn/interrupt':
        // Accepts the interrupt but ends nothing on its own.
        this.ok(id, {});
        return;
      default:
        this.fail(id, { code: -32601, message: `Method not found: ${method}` });
    }
  }

  private applyCancel(): void {
    const stopReason = this.cancelStopReason;
    for (const entry of this.openPrompts.splice(0)) this.resolvePrompt(entry.id, stopReason);
  }

  private ok(id: string | number, result: unknown): void {
    this.send({ jsonrpc: '2.0', id, result });
  }

  private fail(id: string | number, error: { code: number; message: string; data?: unknown }): void {
    this.send({ jsonrpc: '2.0', id, error });
  }
}