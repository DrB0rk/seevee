/**
 * `seevee open [path]` — open the dashboard URL in the default browser.
 *
 * Spec: `.dev/specs/CLI_INSTALLER.md` §8, §9 (open).
 */

import type { CommandContext, CommandResult } from '../cli.js';
import { WorkspaceNotInitializedError } from '../cli.js';
import {
  discoverWorkspace,
  WorkspaceNotFoundError,
} from '../runtime/workspace-discovery.js';
import { status } from '../runtime/daemon.js';
import { openInBrowser } from '../runtime/browser.js';

export async function runOpen(ctx: CommandContext): Promise<CommandResult> {
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
  if (!result.running || result.runtime === undefined) {
    return {
      ok: false,
      code: 5,
      data: { url: null },
      message: 'dashboard is not running — start it with `seevee start`.',
    };
  }

  const url = `http://${result.runtime.host}:${result.runtime.port}/`;
  if (ctx.flags.noOpen) {
    return {
      ok: true,
      code: 0,
      data: { url, opened: false },
      message: ctx.flags.json ? undefined : `browser launch skipped (--no-open); visit ${url}`,
    };
  }
  const opened = await openInBrowser(url);
  return {
    ok: true,
    code: 0,
    data: { url, opened },
    message: ctx.flags.json
      ? undefined
      : opened
        ? `opened ${url}`
        : `browser launcher unavailable; visit ${url} manually.`,
  };
}
