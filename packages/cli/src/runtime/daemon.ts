/**
 * daemon.ts — spawn/manage the detached Seevee dashboard server.
 *
 * Lifecycle:
 *   start() → daemon stays alive as a detached process
 *   stop()   → SIGTERM → SIGKILL if needed
 *   status() → read runtime state + health probe, no side effects
 *
 * PID files are hints only. We always verify liveness via /api/health before
 * reporting a process as "running".
 */

import { spawn } from 'node:child_process';
import { dirname, join } from 'node:path';
import { closeSync, openSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import {
  DEFAULT_PREFERRED_PORT,
  findAvailablePort,
  PortUnavailableError,
} from './ports.js';
import {
  readRuntimeState,
  writeRuntimeState,
  type RuntimeState,
} from './process-state.js';
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
    const body = (await res.json()) as { workspaceId?: string };
    return body.workspaceId === hc.workspaceId;
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
        serverVersion: '0.1.0',
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
    const body = (await res.json()) as { workspaceId?: string };
    return body.workspaceId === state.workspaceId;
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
  const host = opts.host ?? '127.0.0.1';
  const preferredPort = opts.port ?? DEFAULT_PREFERRED_PORT;
  const logFile = opts.workspace.logFile;

  // 1. Reuse a healthy persisted runtime.
  try {
    const prior = await readRuntimeState(opts.workspace.runtimeStateFile);
    if (prior) {
      const live = await isRuntimeStateLive(prior, host, prior.port);
      if (live) return { state: prior, reused: true };
    }
  } catch {
    // No prior state — proceed to start fresh.
  }

  // 2. Choose a port.
  let port: number;
  try {
    port = await findAvailablePort(host, preferredPort);
  } catch (err) {
    if (err instanceof PortUnavailableError) throw new DaemonStartError(err.message, logFile);
    throw err;
  }
  // 3. Spawn detached. Development runs use TypeScript through tsx; release
  // bundles contain compiled JavaScript and no tsx runtime dependency.
  const sourceMode = import.meta.url.endsWith('.ts');
  const serverEntry = fileURLToPath(
    new URL(sourceMode ? './daemon-server.ts' : './daemon-server.js', import.meta.url),
  );
  const cliRoot = fileURLToPath(new URL(sourceMode ? '../../' : '../../../', import.meta.url));
  const childEnv = { ...process.env };
  if (sourceMode) {
    childEnv.NODE_OPTIONS = [process.env.NODE_OPTIONS, '--import tsx'].filter(Boolean).join(' ');
  }
  await mkdir(dirname(logFile), { recursive: true });
  const logFd = openSync(logFile, 'a');
  let child;
  try {
    child = spawn(
      process.execPath,
      [serverEntry, opts.workspace.root, host, String(port), opts.workspaceId],
      {
        cwd: cliRoot,
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

  // 4. Wait for health.
  const state = await waitForHealthy({
    host,
    port,
    workspaceId: opts.workspaceId,
    expectedPid: pid,
    startTime: Date.now(),
  });

  // 5. Persist runtime state and PID.
  await writeRuntimeState(opts.workspace.runtimeStateFile, state);
  await writeFile(opts.workspace.pidFile, String(pid), 'utf8');

  return { state, reused: false };
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
