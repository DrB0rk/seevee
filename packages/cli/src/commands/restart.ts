/**
 * `seevee restart [path]` — stop then start.
 *
 * Spec: `.dev/specs/CLI_INSTALLER.md` §9 (restart).
 */

import type { CommandContext, CommandResult } from '../cli.js';
import { runStop } from './stop.js';
import { runStart } from './start.js';

export async function runRestart(ctx: CommandContext): Promise<CommandResult> {
  const stopResult = await runStop(ctx);
  if (!stopResult.ok && stopResult.code !== 0) {
    return stopResult;
  }
  return runStart(ctx);
}
