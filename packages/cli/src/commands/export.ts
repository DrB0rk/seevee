/**
 * `seevee export [--template=ID] [--output=path]` — export the active CV.
 *
 * Spec: `.dev/specs/CLI_INSTALLER.md` §9 (export), §10 (--json, exit 6).
 *
 * The CLI is a thin client: it asks the running dashboard server to render
 * the PDF (the dashboard owns the Chromium install). If no server is
 * reachable, surface a precise exit-6 error.
 */
import { type CommandContext, type CommandResult } from '../cli.js';

export async function runExport(_ctx: CommandContext): Promise<CommandResult> {
  return {
    ok: false,
    code: 6,
    message: 'seevee export is not yet implemented — coming in P2 (renderer package).',
  };
}
