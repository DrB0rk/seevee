/**
 * `seevee status [path]` — report server runtime state without side effects.
 *
 * Spec: `.dev/specs/CLI_INSTALLER.md` §9 (status), §10 (--json).
 */

import type { CommandContext, CommandResult } from '../cli.js';
import { WorkspaceNotInitializedError } from '../cli.js';
import {
  discoverWorkspace,
  WorkspaceNotFoundError,
} from '../runtime/workspace-discovery.js';
import { status } from '../runtime/daemon.js';

export async function runStatus(ctx: CommandContext): Promise<CommandResult> {
  const target = ctx.positional[0];
  let ws;
  try {
    ws = await discoverWorkspace(target, ctx.cwd);
  } catch (err) {
    if (err instanceof WorkspaceNotFoundError) {
      throw new WorkspaceNotInitializedError(`no workspace at ${target ?? ctx.cwd}`);
    }
    throw err;
  }

  const result = await status({ workspace: ws });
  const url = result.runtime
    ? `http://${result.runtime.host}:${result.runtime.port}`
    : null;

  if (!result.running) {
    return {
      ok: true,
      code: 0,
      data: { running: false, runtime: result.runtime ?? null, url },
      message: ctx.flags.json
        ? undefined
        : result.runtime
          ? 'persisted runtime state exists but server is not responding (stale).'
          : 'dashboard is not running.',
    };
  }

  return {
    ok: true,
    code: 0,
    data: { running: true, url, runtime: result.runtime },
    message: ctx.flags.json
      ? undefined
      : `dashboard running at ${url} (pid ${result.runtime!.pid}).`,
  };
}
