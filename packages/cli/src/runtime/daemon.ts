/**
 * daemon.ts — spawn/manage the detached Seevee dashboard server.
 *
 * Lifecycle:
 *   start() → daemon stays alive as a detached process
 *   stop()   → SIGTERM → SIGKILL if needed
 *   status() → read runtime state + health probe, no side effects
 *
 * PID files are hints only. We always verify the Studio server via /api/health
 * before reporting a process as "running".
 */

import { spawn } from 'node:child_process';
import { dirname, join } from 'node:path';
import { closeSync, openSync } from 'node:fs';
import { mkdir, realpath, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import {
  DEFAULT_PREFERRED_PORT,
  findAvailablePort,
  PortUnavailableError,
} from './ports.js';
import {
  isProcessAlive,
  readRuntimeState,
  writeRuntimeState,
  type RuntimeState,
} from './process-state.js';
import { acquireStartLock } from './start-lock.js';
import type { DiscoveredWorkspace } from './workspace-discovery.js';

export type { RuntimeState };

// ---------------------------------------------------------------------------
// Error types
// ---------------------------------------------------------------------------

export class DaemonStartError extends Error {
  readonly code = 'DAEMON_START_ERROR' as const;
  constructor(message: string, public readonly logFile?: string) {
    super(message);
    this.name = 'DaemonStartError';
  }
}

// ---------------------------------------------------------------------------
// Health check
// ---------------------------------------------------------------------------

interface HealthCheck {
  host: string;
  port: number;
  workspaceId: string;
  expectedPid: number;
  startTime: number;
}

async function isHealthy(hc: HealthCheck): Promise<boolean> {
  try {
    const res = await fetch(`http://${hc.host}:${hc.port}/api/health`, {
      signal: AbortSignal.timeout(2000),
    });
    if (!res.ok) return false;
    const body = (await res.json()) as { workspaceId?: string; pid?: number };
    return body.workspaceId === hc.workspaceId && body.pid === hc.expectedPid;
  } catch {
    return false;
  }
}

const HEALTH_TIMEOUT_MS = 15_000;

async function waitForHealthy(hc: HealthCheck): Promise<RuntimeState> {
  const deadline = hc.startTime + HEALTH_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (await isHealthy(hc)) {
      return {
        workspaceId: hc.workspaceId,
        pid: hc.expectedPid,
        host: hc.host,
        port: hc.port,
        startedAt: new Date().toISOString(),
        serverVersion: process.env.SEEVEE_VERSION ?? '0.1.0-alpha.4',
      };
    }
    await new Promise<void>((resolve) => setTimeout(resolve, 200));
  }
  throw new DaemonStartError(
    'Health check timed out after ' + HEALTH_TIMEOUT_MS + 'ms for workspace ' + hc.workspaceId,
  );
}

async function isRuntimeStateLive(
  state: RuntimeState,
  host: string,
  port: number,
): Promise<boolean> {
  try {
    const res = await fetch(`http://${host}:${port}/api/health`, {
      signal: AbortSignal.timeout(2000),
    });
    if (!res.ok) return false;
    const body = (await res.json()) as { workspaceId?: string; pid?: number };
    return body.workspaceId === state.workspaceId && body.pid === state.pid;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------

export interface StartOptions {
  workspace: DiscoveredWorkspace;
  workspaceId: string;
  host?: string;
  port?: number;
}

export interface StartResult {
  state: RuntimeState;
  reused: boolean;
}

export async function start(opts: StartOptions): Promise<StartResult> {
  const releaseLock = await acquireWorkspaceLock(opts.workspace, opts.workspace.logFile);
  try {
    return await startLocked(opts);
  } finally {
    await releaseLock();
  }
}

async function startLocked(opts: StartOptions): Promise<StartResult> {
  const host = opts.host ?? '127.0.0.1';
  const preferredPort = opts.port ?? DEFAULT_PREFERRED_PORT;
  const logFile = opts.workspace.logFile;

  // 1. Reuse a healthy persisted runtime.
  let prior: RuntimeState | null = null;
  try {
    prior = await readRuntimeState(opts.workspace.runtimeStateFile);
  } catch {
    // Missing or malformed state — proceed to start fresh.
  }
  if (prior) {
    const live = await isRuntimeStateLive(prior, prior.host, prior.port);
    if (live) return { state: prior, reused: true };
    if (await isProcessAlive(prior.pid)) {
      const warming = await waitForExistingRuntime(prior);
      if (warming) {
        await writeRuntimeState(opts.workspace.runtimeStateFile, warming);
        return { state: warming, reused: true };
      }
      throw new DaemonStartError(
        `Seevee process ${prior.pid} is still alive but does not answer its health check; refusing to start a duplicate. Run seevee stop first.`,
        logFile,
      );
    }
  }

  // 2. Choose a port.
  let port: number;
  try {
    port = await findAvailablePort(host, preferredPort);
  } catch (err) {
    if (err instanceof PortUnavailableError) throw new DaemonStartError(err.message, logFile);
    throw err;
  }
  // 3. Spawn the compiled Astro Studio server. The source checkout and the
  // release bundle keep Studio at different relative paths beside the CLI.
  const sourceMode = import.meta.url.endsWith('.ts');
  const serverEntry = fileURLToPath(
    new URL(
      sourceMode ? '../../../../apps/studio/dist/server/entry.mjs' : '../../../studio/dist/server/entry.mjs',
      import.meta.url,
    ),
  );
  const childEnv = {
    ...process.env,
    HOST: host,
    PORT: String(port),
    SEEVEE_WORKSPACE_ROOT: opts.workspace.root,
  };
  await mkdir(dirname(logFile), { recursive: true });
  const logFd = openSync(logFile, 'a');
  let child;
  try {
    child = spawn(
      process.execPath,
      [serverEntry, opts.workspace.root, host, String(port), opts.workspaceId],
      {
        cwd: opts.workspace.root,
        detached: true,
        stdio: ['ignore', logFd, logFd],
        windowsHide: true,
        env: childEnv,
      },
    );
  } finally {
    closeSync(logFd);
  }
  child.unref();
  if (typeof child.pid !== 'number') {
    throw new DaemonStartError('spawn returned no pid', logFile);
  }
  const pid = child.pid;

  const provisional: RuntimeState = {
    workspaceId: opts.workspaceId,
    pid,
    host,
    port,
    startedAt: new Date().toISOString(),
    serverVersion: process.env.SEEVEE_VERSION ?? '0.1.0-alpha.4',
  };
  try {
    // Persist the child identity before waiting for HTTP health. If the CLI is
    // interrupted during startup, another invocation can find and reuse it.
    await writeRuntimeState(opts.workspace.runtimeStateFile, provisional);
    await writeFile(opts.workspace.pidFile, String(pid), 'utf8');
    const state = await waitForHealthy({
      host,
      port,
      workspaceId: opts.workspaceId,
      expectedPid: pid,
      startTime: Date.now(),
    });
    await writeRuntimeState(opts.workspace.runtimeStateFile, state);
    return { state, reused: false };
  } catch (error) {
    try {
      process.kill(pid, 'SIGTERM');
    } catch {
      // The child may already have exited.
    }
    await clearRuntime(opts.workspace);
    throw error;
  }
}

async function waitForExistingRuntime(state: RuntimeState): Promise<RuntimeState | null> {
  const deadline = Date.now() + HEALTH_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (!(await isProcessAlive(state.pid))) return null;
    if (await isRuntimeStateLive(state, state.host, state.port)) return state;
    await new Promise<void>((resolve) => setTimeout(resolve, 200));
  }
  return null;
}

async function acquireWorkspaceLock(
  workspace: DiscoveredWorkspace,
  logFile: string,
): Promise<() => Promise<void>> {
  const root = await realpath(workspace.root);
  const lockPath = join(root, '.seevee', 'daemon-start.lock');
  const deadline = Date.now() + HEALTH_TIMEOUT_MS + 5_000;
  while (Date.now() < deadline) {
    const release = await acquireStartLock(lockPath);
    if (release) return release;
    await new Promise<void>((resolve) => setTimeout(resolve, 100));
  }
  throw new DaemonStartError('Another Seevee start or stop is still in progress; refusing to launch a duplicate.', logFile);
}

// ---------------------------------------------------------------------------
// Stop
// ---------------------------------------------------------------------------

export interface StopResult {
  stopped: boolean;
  reason: 'not-running' | 'signal-sent' | 'forced-kill';
  runtime?: RuntimeState;
}

export async function stop(opts: { workspace: DiscoveredWorkspace }): Promise<StopResult> {
  const releaseLock = await acquireWorkspaceLock(opts.workspace, opts.workspace.logFile);
  try {
    return await stopLocked(opts);
  } finally {
    await releaseLock();
  }
}

async function stopLocked(opts: { workspace: DiscoveredWorkspace }): Promise<StopResult> {
  let state: RuntimeState | null = null;
  try {
    state = await readRuntimeState(opts.workspace.runtimeStateFile);
  } catch {
    return { stopped: false, reason: 'not-running' };
  }
  if (!state) return { stopped: false, reason: 'not-running' };

  // Try graceful SIGTERM first.
  try {
    process.kill(state.pid, 'SIGTERM');
    await new Promise<void>((resolve) => setTimeout(resolve, 3000));
  } catch (err: unknown) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code !== 'ESRCH') throw err;
    await clearRuntime(opts.workspace);
    return { stopped: false, reason: 'not-running', runtime: state };
  }

  // Check if still alive after grace.
  try {
    process.kill(state.pid, 0);
  } catch {
    await clearRuntime(opts.workspace);
    return { stopped: true, reason: 'signal-sent', runtime: state };
  }

  // Force kill.
  try {
    process.kill(state.pid, 'SIGKILL');
  } catch (err: unknown) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code !== 'ESRCH') throw err;
  }
  await clearRuntime(opts.workspace);
  return { stopped: true, reason: 'forced-kill', runtime: state };
}

async function clearRuntime(ws: DiscoveredWorkspace): Promise<void> {
  await writeFile(ws.pidFile, '', 'utf8').catch(() => {});
  // writeRuntimeState takes RuntimeState (not null); use the empty-state side effect
  // by writing a state with pid=0 to mark as cleared.
  await writeFile(ws.runtimeStateFile, JSON.stringify({ cleared: true }), 'utf8').catch(() => {});
}

// ---------------------------------------------------------------------------
// Status
// ---------------------------------------------------------------------------

export interface StatusResult {
  running: boolean;
  runtime?: RuntimeState;
}

export async function status(opts: { workspace: DiscoveredWorkspace }): Promise<StatusResult> {
  let state: RuntimeState | null = null;
  try {
    state = await readRuntimeState(opts.workspace.runtimeStateFile);
  } catch {
    return { running: false };
  }
  if (!state) return { running: false };

  const live = await isRuntimeStateLive(state, state.host, state.port);
  if (live) return { running: true, runtime: state };
  return { running: false, runtime: state };
}
