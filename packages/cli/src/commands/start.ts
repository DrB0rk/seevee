/**
 * `seevee start [path]` — start the detached background server.
 *
 * Spec: `.dev/specs/CLI_INSTALLER.md` §7, §9 (start), §10 (--json).
 */

import type { CommandContext, CommandResult } from '../cli.js';
import { WorkspaceNotInitializedError } from '../cli.js';
import {
  discoverWorkspace,
  WorkspaceNotFoundError,
} from '../runtime/workspace-discovery.js';
import { start } from '../runtime/daemon.js';
import { readWorkspaceId } from '../scaffold/create-workspace.js';

export async function runStart(ctx: CommandContext): Promise<CommandResult> {
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

  const workspaceId = await readWorkspaceId(ws);

  const opts: Parameters<typeof start>[0] = {
    workspace: ws,
    workspaceId,
    host: ctx.flags.host ?? '127.0.0.1',
  };
  if (typeof ctx.flags.port === 'number') {
    opts.port = ctx.flags.port;
  }

  const result = await start(opts);
  const url = `http://${result.state.host}:${result.state.port}`;
  return {
    ok: true,
    code: 0,
    data: { url, ...result.state, reused: result.reused },
    message: ctx.flags.json
      ? undefined
      : result.reused
        ? `dashboard already running at ${url} (reused).`
        : `dashboard started at ${url} (pid ${result.state.pid}).`,
  };
}
