/**
 * `seevee export [--template=ID] [--output=path]` — export the active CV.
 *
 * Spec: `.dev/specs/CLI_INSTALLER.md` §9 (export), §10 (--json, exit 6).
 *
 * PDF export is not implemented yet. Keep the response actionable so agents
 * can use the supported dashboard print flow instead of retrying this command.
 */
import { type CommandContext, type CommandResult } from '../cli.js';

export async function runExport(_ctx: CommandContext): Promise<CommandResult> {
  return {
    ok: false,
    code: 6,
    message: 'PDF export is not available in the CLI yet. Open the dashboard and choose Print to PDF from your browser.',
  };
}
