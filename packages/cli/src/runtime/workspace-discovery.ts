import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

/**
 * Workspace discovery for the Seevee CLI.
 *
 * Per `.dev/specs/CLI_INSTALLER.md` §5 the canonical workspace marker is
 * `seevee.json` at the workspace root. The runtime directory is `.seevee/`.
 *
 * Discovery precedence:
 *   1. explicit `path` argument (init/start/etc.)
 *   2. `process.cwd()` resolved to absolute path
 *   3. walk up from cwd looking for a `seevee.json` marker
 */

export interface DiscoveredWorkspace {
  /** Absolute path to the workspace root (directory containing `seevee.json`). */
  root: string;
  /** Absolute path to the workspace runtime directory (`.seevee/`). */
  runtimeDir: string;
  /** Absolute path to `seevee.json`. */
  workspaceFile: string;
  /** Absolute path to the validated `runtime.json`. */
  runtimeStateFile: string;
  /** Absolute path to the persisted PID file. */
  pidFile: string;
  /** Absolute path to the detached server's append-mode log file. */
  logFile: string;
}

export {
  DEFAULT_PREFERRED_PORT,
  PORT_SEARCH_RANGE_START,
  PORT_SEARCH_RANGE_END,
} from './ports.js';

export class WorkspaceNotFoundError extends Error {
  public override readonly name = 'WorkspaceNotFoundError';
  constructor(message: string) {
    super(message);
  }
}

export function resolveAbsolutePath(target: string, cwd: string = process.cwd()): string {
  if (path.isAbsolute(target)) {
    return path.normalize(target);
  }
  return path.normalize(path.resolve(cwd, target));
}

async function pathExists(p: string): Promise<boolean> {
  try {
    const stat = await fs.stat(p);
    return stat.isDirectory();
  } catch {
    return false;
  }
}

async function fileExists(p: string): Promise<boolean> {
  try {
    const stat = await fs.stat(p);
    return stat.isFile();
  } catch {
    return false;
  }
}

/**
 * Look for a workspace marker starting at `startDir` and walking up to the
 * filesystem root. Returns the directory containing `seevee.json`, or null.
 */
export async function findWorkspaceRoot(startDir: string): Promise<string | null> {
  let current = path.normalize(startDir);
  // Bound walk: don't go above the user's home directory or the FS root.
  while (true) {
    const candidate = path.join(current, 'seevee.json');
    if (await fileExists(candidate)) {
      return current;
    }
    const parent = path.dirname(current);
    if (parent === current) {
      return null;
    }
    current = parent;
  }
}

/**
 * Resolve a workspace for a CLI invocation. `explicit` is the user-supplied
 * path (if any); `cwd` is the process current working directory.
 *
 * Precedence:
 *   - explicit path wins when supplied;
 *   - otherwise walk up from cwd;
 *   - throws `WorkspaceNotFoundError` when no marker is found.
 */
export async function discoverWorkspace(
  explicit: string | undefined,
  cwd: string = process.cwd(),
): Promise<DiscoveredWorkspace> {
  let root: string | null = null;
  if (explicit !== undefined && explicit !== '') {
    const abs = resolveAbsolutePath(explicit, cwd);
    if (!(await pathExists(abs))) {
      throw new WorkspaceNotFoundError(`path does not exist: ${abs}`);
    }
    // Allow pointing at either the workspace root or the workspace file.
    const stat = await fs.stat(abs);
    if (stat.isFile() && path.basename(abs) === 'seevee.json') {
      root = path.dirname(abs);
    } else if (stat.isDirectory()) {
      // Prefer the directory's own marker if it has one.
      const own = await findWorkspaceRoot(abs);
      root = own ?? abs;
    }
  } else {
    root = await findWorkspaceRoot(cwd);
  }
  if (root === null) {
    throw new WorkspaceNotFoundError(
      `no seevee.json found in ${cwd} or any parent directory`,
    );
  }
  return workspaceAt(root);
}

export function workspaceAt(root: string): DiscoveredWorkspace {
  const abs = path.resolve(root);
  const runtimeDir = path.join(abs, '.seevee');
  return {
    root: abs,
    runtimeDir,
    workspaceFile: path.join(abs, 'seevee.json'),
    runtimeStateFile: path.join(runtimeDir, 'runtime.json'),
    pidFile: path.join(runtimeDir, 'server.pid'),
    logFile: path.join(runtimeDir, 'logs', 'server.log'),
  };
}

/**
 * Determine the workspace `name` from the marker. Falls back to the basename
 * of the workspace root when the marker file does not exist yet.
 */
export async function readWorkspaceName(ws: DiscoveredWorkspace): Promise<string> {
  try {
    const raw = await fs.readFile(ws.workspaceFile, 'utf8');
    const parsed: unknown = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && 'name' in parsed) {
      const name = (parsed as Record<string, unknown>).name;
      if (typeof name === 'string' && name.length > 0) {
        return name;
      }
    }
  } catch {
    // fall through to basename fallback
  }
  return path.basename(ws.root);
}
