/**
 * Workspace context preamble.
 *
 * A fresh agent session has no conversation history, so the agent cannot tell
 * "start over" from "pick up where the last one left off" — and it has no way
 * to know which document the user is actually looking at. Both answers are in
 * `seevee.json`, so the runtime reads them once at session start and hands the
 * agent a short, factual block instead of making it go looking.
 */

import fs from 'node:fs/promises';
import path from 'node:path';

export interface WorkspaceContextSummary {
  readonly activeCv: string | null;
  readonly activePresentation: string | null;
  readonly templateIds: readonly string[];
  readonly cvCount: number;
  readonly presentationCount: number;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null ? value as Record<string, unknown> : null;
}

function stringOrNull(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

/** Read the active document pointers out of a workspace marker. */
export async function readWorkspaceContext(workspaceRoot: string): Promise<WorkspaceContextSummary | null> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(await fs.readFile(path.join(workspaceRoot, 'seevee.json'), 'utf8'));
  } catch {
    return null;
  }
  const document = asRecord(parsed);
  const data = asRecord(document?.['data']);
  if (data === null) return null;
  const active = asRecord(data['active']);
  const resources = asRecord(data['resources']);
  if (resources === null) return null;
  const templates = asRecord(resources['templates']) ?? {};
  const templateIds = Object.keys(templates);
  return {
    activeCv: stringOrNull(active?.['cvId']),
    activePresentation: stringOrNull(active?.['presentationId']),
    templateIds,
    cvCount: Object.keys(asRecord(resources['cvs']) ?? {}).length,
    presentationCount: Object.keys(asRecord(resources['presentations']) ?? {}).length,
  };
}

/**
 * Render the context block appended to the agent's system instructions.
 *
 * `resumed` is stated explicitly: a resumed session keeps its conversation,
 * a new one does not, and the files on disk are the only memory either has.
 */
export function formatWorkspaceContext(
  context: WorkspaceContextSummary | null,
  options: { resumed: boolean },
): string {
  if (context === null) {
    return [
      '## Workspace context',
      '',
      'No Seevee workspace marker was found at the session root. Confirm the working directory before editing anything.',
    ].join('\n');
  }
  const lines = [
    '## Workspace context',
    '',
    options.resumed
      ? 'This session resumed an existing conversation. Earlier turns are in the provider history.'
      : 'This is a new session. There is no earlier conversation — anything a previous session produced exists only as files in this workspace.',
    '',
    `Active CV: ${context.activeCv ?? 'none set'}`,
    `Active presentation: ${context.activePresentation ?? 'none set'}`,
    `Templates registered: ${context.templateIds.length > 0 ? context.templateIds.join(', ') : 'none'}`,
    `Workspace holds ${context.cvCount} CV(s) and ${context.presentationCount} presentation(s).`,
    '',
    'When the user asks about the contents, identity, or wording of the active CV, read `cvs/<active CV>.json` before answering. Do not say you have not read it without checking the file. When the user says "this CV", "the header", or "it", they mean the active document above. Read its current revision before changing it, and say which document you are working on when it is ambiguous.',
  ];
  return lines.join('\n');
}
