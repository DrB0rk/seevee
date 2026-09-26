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

const UPLOAD_INDEX_PATH = 'sources/uploads/index.json';

export interface WorkspaceContextSummary {
  readonly activeCv: string | null;
  readonly activePresentation: string | null;
  readonly activeCvPath: string | null;
  readonly activePresentationPath: string | null;
  readonly activeProvenancePath: string | null;
  readonly activeCommentsPath: string | null;
  readonly templateIds: readonly string[];
  readonly sourceRegistrations: readonly { id: string; relativePath: string; type: string }[];
  readonly uploadedAssets: readonly { name: string; relativePath: string; purpose: string; contentType: string; size: number }[];
  readonly cvCount: number;
  readonly presentationCount: number;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null ? value as Record<string, unknown> : null;
}

function stringOrNull(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function registeredPath(registrations: Record<string, unknown>, id: string | null): string | null {
  if (id === null) return null;
  return stringOrNull(asRecord(registrations[id])?.['relativePath']);
}

function pathForCv(registrations: Record<string, unknown>, cvId: string | null): string | null {
  if (cvId === null) return null;
  const registration = registrations[cvId] ?? Object.values(registrations).find((value) => asRecord(value)?.['cvId'] === cvId);
  return stringOrNull(asRecord(registration)?.['relativePath']);
}

function isSafeUploadPath(value: unknown): value is string {
  if (typeof value !== 'string' || !value.startsWith('sources/uploads/') || value.length > 512) return false;
  const segments = value.split('/');
  return !value.includes('\\')
    && !value.includes('\0')
    && segments.length > 2
    && segments.every((segment) => segment !== '' && segment !== '..');
}

function uploadedAssetSummary(value: unknown): { name: string; relativePath: string; purpose: string; contentType: string; size: number } | null {
  if (typeof value !== 'object' || value === null) return null;
  const asset = value as Record<string, unknown>;
  if (
    typeof asset.name !== 'string' || asset.name.length > 240
    || !isSafeUploadPath(asset.relativePath)
    || typeof asset.purpose !== 'string' || asset.purpose.length > 64
    || typeof asset.contentType !== 'string' || asset.contentType.length > 128
    || typeof asset.size !== 'number'
    || !Number.isFinite(asset.size)
    || asset.size < 0
  ) return null;
  return { name: asset.name, relativePath: asset.relativePath, purpose: asset.purpose, contentType: asset.contentType, size: asset.size };
}

async function readUploadedAssetInventory(workspaceRoot: string): Promise<WorkspaceContextSummary['uploadedAssets']> {
  try {
    const parsed: unknown = JSON.parse(await fs.readFile(path.join(workspaceRoot, UPLOAD_INDEX_PATH), 'utf8'));
    return Array.isArray(parsed)
      ? parsed.map(uploadedAssetSummary).filter((asset): asset is NonNullable<typeof asset> => asset !== null)
      : [];
  } catch {
    return [];
  }
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
  const cvs = asRecord(resources['cvs']) ?? {};
  const presentations = asRecord(resources['presentations']) ?? {};
  const provenance = asRecord(resources['provenance']) ?? {};
  const comments = asRecord(resources['comments']) ?? {};
  const sources = asRecord(resources['sources']) ?? {};
  const activeCv = stringOrNull(active?.['cvId']);
  const activePresentation = stringOrNull(active?.['presentationId']);
  const templateIds = Object.keys(templates);
  const uploadedAssets = await readUploadedAssetInventory(workspaceRoot);
  return {
    activeCv,
    activePresentation,
    activeCvPath: registeredPath(cvs, activeCv),
    activePresentationPath: registeredPath(presentations, activePresentation),
    activeProvenancePath: pathForCv(provenance, activeCv),
    activeCommentsPath: pathForCv(comments, activeCv),
    templateIds,
    sourceRegistrations: Object.entries(sources).flatMap(([id, value]) => {
      const registration = asRecord(value);
      const relativePath = stringOrNull(registration?.['relativePath']);
      const type = stringOrNull(registration?.['type']);
      return relativePath === null || type === null ? [] : [{ id, relativePath, type }];
    }),
    uploadedAssets,
    cvCount: Object.keys(cvs).length,
    presentationCount: Object.keys(presentations).length,
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
    `Active resource paths: CV ${context.activeCvPath ?? 'not registered'}; presentation ${context.activePresentationPath ?? 'not registered'}; provenance ${context.activeProvenancePath ?? 'not registered'}; comments ${context.activeCommentsPath ?? 'not registered'}.`,
    `Registered sources: ${context.sourceRegistrations.length === 0 ? 'none' : context.sourceRegistrations.map(({ id, relativePath, type }) => `${id} (${type}): ${relativePath}`).join('; ')}.`,
    `Uploaded reference files: ${context.uploadedAssets.length === 0 ? 'none' : context.uploadedAssets.map(({ name, relativePath, purpose, contentType, size }) => `${name} (${purpose}, ${contentType}, ${size} bytes): ${relativePath}`).join('; ')}.`,
    `Templates registered: ${context.templateIds.length > 0 ? context.templateIds.join(', ') : 'none'}`,
    `Workspace holds ${context.cvCount} CV(s) and ${context.presentationCount} presentation(s).`,
    '',
    'The Studio adds a private, fresh snapshot of the active CV, presentation, provenance, comments, resource paths, and source inventory to every user prompt. Use that snapshot to start work immediately. When the user says "this CV", "the header", or "it", they mean the active document above. Read a registered file only when the current prompt needs detail the snapshot does not include, or when you need to confirm freshness before writing.',
  ];
  return lines.join('\n');
}
