import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import readline from 'node:readline';

export type JsonRpcId = string | number;

export interface JsonRpcErrorShape {
  code: number;
  message: string;
  data?: unknown;
}

export interface JsonRpcRequestMessage {
  jsonrpc?: '2.0';
  id: JsonRpcId;
  method: string;
  params?: unknown;
}

export interface JsonRpcNotificationMessage {
  jsonrpc?: '2.0';
  method: string;
  params?: unknown;
}

export interface JsonRpcResponseMessage {
  jsonrpc?: '2.0';
  id: JsonRpcId;
  result?: unknown;
  error?: JsonRpcErrorShape;
}

export type JsonRpcIncomingMessage = JsonRpcRequestMessage | JsonRpcNotificationMessage | JsonRpcResponseMessage;

export interface JsonRpcProcessOptions {
  command: string;
  args: string[];
  cwd: string;
  includeJsonRpcVersion?: boolean;
  requestTimeoutMs?: number;
  env?: NodeJS.ProcessEnv;
}

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout;
}

export class JsonRpcProcessError extends Error {
  readonly code: number;
  readonly data: unknown;

  constructor(error: JsonRpcErrorShape) {
    super(error.message);
    this.name = 'JsonRpcProcessError';
    this.code = error.code;
    this.data = error.data;
  }
}

export class JsonRpcProcessClient {
  private readonly child: ChildProcessWithoutNullStreams;
  private readonly pending = new Map<JsonRpcId, PendingRequest>();
  private readonly stderrLines: string[] = [];
  private readonly includeJsonRpcVersion: boolean;
  private readonly requestTimeoutMs: number;
  private nextId = 1;
  private closed = false;
  private closeReason: Error | null = null;

  onNotification: (message: JsonRpcNotificationMessage) => void = () => undefined;
  onRequest: (message: JsonRpcRequestMessage) => void = () => undefined;
  onClose: (error: Error | null) => void = () => undefined;

  constructor(options: JsonRpcProcessOptions) {
    this.includeJsonRpcVersion = options.includeJsonRpcVersion ?? false;
    this.requestTimeoutMs = options.requestTimeoutMs ?? 30_000;
    this.child = spawn(options.command, options.args, {
      cwd: options.cwd,
      env: options.env ?? process.env,
      shell: false,
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    const stdout = readline.createInterface({ input: this.child.stdout, crlfDelay: Infinity });
    stdout.on('line', (line) => this.handleLine(line));

    this.child.stderr.setEncoding('utf8');
    this.child.stderr.on('data', (chunk: string) => {
      for (const line of chunk.split(/\r?\n/u)) {
        if (line.length === 0) continue;
        this.stderrLines.push(line);
        if (this.stderrLines.length > 20) this.stderrLines.shift();
      }
    });

    this.child.once('error', (error) => this.handleClose(error));
    this.child.once('exit', (code, signal) => {
      const suffix = signal === null ? `code ${code ?? 'unknown'}` : `signal ${signal}`;
      this.handleClose(new Error(`${this.child.spawnfile} exited with ${suffix}`));
    });
  }

  get stderrText(): string {
    return this.stderrLines.join('\n');
  }

  get isClosed(): boolean {
    return this.closed;
  }

  async request<T = unknown>(method: string, params?: unknown, timeoutMs = this.requestTimeoutMs): Promise<T> {
    if (this.closed) throw this.closeReason ?? new Error('JSON-RPC process is closed');
    const id = this.nextId++;
    const payload: JsonRpcRequestMessage = {
      ...(this.includeJsonRpcVersion ? { jsonrpc: '2.0' as const } : {}),
      id,
      method,
      ...(params === undefined ? {} : { params }),
    };
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`JSON-RPC request timed out: ${method}`));
      }, timeoutMs);
      timer.unref?.();
      this.pending.set(id, {
        resolve: (value) => resolve(value as T),
        reject,
        timer,
      });
      this.write(payload);
    });
  }

  notify(method: string, params?: unknown): void {
    if (this.closed) throw this.closeReason ?? new Error('JSON-RPC process is closed');
    const payload: JsonRpcNotificationMessage = {
      ...(this.includeJsonRpcVersion ? { jsonrpc: '2.0' as const } : {}),
      method,
      ...(params === undefined ? {} : { params }),
    };
    this.write(payload);
  }

  respond(id: JsonRpcId, result: unknown): void {
    if (this.closed) return;
    this.write({
      ...(this.includeJsonRpcVersion ? { jsonrpc: '2.0' as const } : {}),
      id,
      result,
    });
  }

  respondError(id: JsonRpcId, code: number, message: string, data?: unknown): void {
    if (this.closed) return;
    this.write({
      ...(this.includeJsonRpcVersion ? { jsonrpc: '2.0' as const } : {}),
      id,
      error: { code, message, ...(data === undefined ? {} : { data }) },
    });
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    this.child.stdin.end();
    const exited = new Promise<void>((resolve) => this.child.once('exit', () => resolve()));
    const termTimer = setTimeout(() => this.child.kill('SIGTERM'), 1_500);
    const killTimer = setTimeout(() => this.child.kill('SIGKILL'), 4_000);
    termTimer.unref?.();
    killTimer.unref?.();
    await exited;
    clearTimeout(termTimer);
    clearTimeout(killTimer);
  }

  private write(message: JsonRpcIncomingMessage): void {
    this.child.stdin.write(`${JSON.stringify(message)}\n`);
  }

  private handleLine(line: string): void {
    if (line.trim().length === 0) return;
    let message: JsonRpcIncomingMessage;
    try {
      message = JSON.parse(line) as JsonRpcIncomingMessage;
    } catch {
      this.closeReason = new Error(`Agent emitted invalid JSON-RPC output: ${line.slice(0, 200)}`);
      this.child.kill();
      return;
    }

    if ('method' in message && 'id' in message) {
      this.onRequest(message);
      return;
    }
    if ('method' in message) {
      this.onNotification(message);
      return;
    }
    if ('id' in message) {
      const pending = this.pending.get(message.id);
      if (pending === undefined) return;
      this.pending.delete(message.id);
      clearTimeout(pending.timer);
      if (message.error !== undefined) pending.reject(new JsonRpcProcessError(message.error));
      else pending.resolve(message.result);
    }
  }

  private handleClose(error: Error): void {
    if (this.closed && this.closeReason !== null) return;
    this.closed = true;
    this.closeReason = error;
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.pending.clear();
    this.onClose(error);
  }
}
