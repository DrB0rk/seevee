/**
 * `seevee stop [path]` — stop the detached background server.
 * Spec: `.dev/specs/CLI_INSTALLER.md` §7.
 */
import { stat, readFile } from 'node:fs/promises';
import { WorkspaceNotInitializedError, type CommandContext, type CommandResult } from '../cli.js';
import { workspaceAt, type DiscoveredWorkspace } from '../runtime/workspace-discovery.js';
import { stop } from '../runtime/daemon.js';

export async function runStop(ctx: CommandContext): Promise<CommandResult> {
  const target = ctx.positional[0] ?? ctx.cwd;
  const ws = await workspaceAt(target);
  await assertInitialized(ws);

  const result = await stop({ workspace: ws });
  return {
    ok: true,
    code: 0,
    data: { stopped: result.stopped, reason: result.reason },
    message: result.stopped
      ? 'Dashboard stopped (' + result.reason + ').'
      : 'Dashboard was not running.',
  };
}

async function assertInitialized(ws: DiscoveredWorkspace): Promise<void> {
  try {
    await stat(ws.workspaceFile);
    await readFile(ws.workspaceFile, 'utf8');
  } catch {
    throw new WorkspaceNotInitializedError(
      'No workspace at ' + ws.root + ' — run `seevee init` first.',
    );
  }
}
