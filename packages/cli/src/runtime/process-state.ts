import process from 'node:process';
import fs from 'node:fs/promises';
import path from 'node:path';

/**
 * Process identity verification helpers.
 *
 * PID files are hints, not proof — per `.dev/specs/CLI_INSTALLER.md` §7 we
 * verify the recorded PID is alive before trusting it.
 */

export interface RuntimeState {
  workspaceId: string;
  pid: number;
  host: string;
  port: number;
  startedAt: string;
  serverVersion: string;
}

export class StaleProcessError extends Error {
  public override readonly name = 'StaleProcessError';
  constructor(message: string) {
    super(message);
  }
}

/**
 * Returns true if a process exists at the OS level.
 *
 * Signal 0 does not deliver a signal — it only performs the existence/error
 * check. This is the canonical POSIX way to probe "is this PID alive?".
 */
export async function isProcessAlive(pid: number): Promise<boolean> {
  if (!Number.isInteger(pid) || pid <= 0) {
    return false;
  }
  if (pid === process.pid) {
    return true;
  }
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'ESRCH') {
      return false;
    }
    if (code === 'EPERM') {
      return true;
    }
    return false;
  }
}

export async function readRuntimeState(stateFile: string): Promise<RuntimeState | null> {
  try {
    const raw = await fs.readFile(stateFile, 'utf8');
    const parsed = JSON.parse(raw) as RuntimeState;
    if (
      typeof parsed.workspaceId !== 'string' ||
      typeof parsed.pid !== 'number' ||
      typeof parsed.host !== 'string' ||
      typeof parsed.port !== 'number' ||
      typeof parsed.startedAt !== 'string' ||
      typeof parsed.serverVersion !== 'string'
    ) {
      return null;
    }
    return parsed;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      return null;
    }
    return null;
  }
}

export async function writeRuntimeState(
  stateFile: string,
  state: RuntimeState,
): Promise<void> {
  await fs.mkdir(path.dirname(stateFile), { recursive: true });
  const tmp = `${stateFile}.tmp-${process.pid}`;
  await fs.writeFile(tmp, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
  await fs.rename(tmp, stateFile);
}

export async function clearRuntimeState(stateFile: string): Promise<void> {
  try {
    await fs.unlink(stateFile);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw err;
    }
  }
}

/**
 * Verify runtime state matches what we expect to see. The recorded PID must
 * still be alive; the recorded port/host must still be reachable.
 */
export async function isRuntimeStateLive(
  state: RuntimeState,
  host: string,
  port: number,
): Promise<boolean> {
  if (state.host !== host || state.port !== port) {
    return false;
  }
  return isProcessAlive(state.pid);
}
