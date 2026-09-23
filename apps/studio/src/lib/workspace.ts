/**
 * Workspace reader — server-side filesystem access for the Seevee Studio.
 *
 * Reads the workspace marker (`seevee.json`) from the workspace root and
 * dereferences the canonical resource files (`cvs/`, `presentations/`,
 * `comments/`, `provenance/`, `sources/`). Every read goes through the
 * matching Zod schema in `@seevee/schema`; a malformed file is returned as
 * a structured failure (not thrown) so the API layer can map it to 400/404
 * responses without losing the underlying issue list.
 *
 * The Studio never trusts workspace files: every byte of JSON is parsed
 * through Zod and a structured failure is produced on any mismatch.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { z } from 'zod';
import {
  workspaceDocumentSchema,
  cvDocumentSchema,
  presentationDocumentSchema,
  commentsDocumentSchema,
  provenanceDocumentSchema,
  sourceDocumentSchema,
  type WorkspaceDocument,
  type CvDocument,
  type PresentationDocument,
  type CommentsDocument,
  type ProvenanceDocument,
  type SourceDocument,
  type PresentationData,
  type PageProfile,
} from '@seevee/schema';

const DEFAULT_ROOT_CANDIDATES: ReadonlyArray<string> = [
  process.env['SEEVEE_WORKSPACE_ROOT'] ?? '',
  process.cwd(),
];

const MARKER_FILE = 'seevee.json';

const PAGE_PRESET_DIMENSIONS_MM: Readonly<Record<PageProfile['preset'], { width: number; height: number }>> = {
  A4: { width: 210, height: 297 },
  Letter: { width: 215.9, height: 279.4 },
  Legal: { width: 215.9, height: 355.6 },
  custom: { width: 210, height: 297 },
};

export type ResourceKind =
  | 'workspace'
  | 'cv'
  | 'presentation'
  | 'comments'
  | 'provenance'
  | 'source';

export interface ResourceFailure {
  ok: false;
  kind: ResourceKind;
  status: 400 | 404 | 500;
  reason: string;
  issues?: readonly z.ZodIssue[];
}

export interface ResourceSuccess<T> {
  ok: true;
  kind: ResourceKind;
  document: T;
}

export type ResourceResult<T> = ResourceSuccess<T> | ResourceFailure;

export interface WorkspaceContext {
  root: string;
  workspace: WorkspaceDocument;
}

/** A summary shape returned to the dashboard for the left data rail. */
export interface CvSummary {
  id: string;
  revision: number;
  updatedAt: string;
  name: string;
  headline: string | null;
  locale: string;
  sectionCount: number;
}

export interface PresentationSummary {
  id: string;
  cvId: string;
  revision: number;
  updatedAt: string;
  templateId: string;
  versionId: string;
  preset: PageProfile['preset'];
  orientation: PageProfile['orientation'];
}

export interface CommentSummary {
  id: string;
  cvId: string;
  revision: number;
  updatedAt: string;
  threadCount: number;
  openCount: number;
}

export interface SourceSummary {
  id: string;
  name: string;
  type: string;
  updatedAt: string;
  contentHash: string;
}

/** Resolved page geometry for a presentation, after preset + custom merging. */
export interface ResolvedPageGeometry {
  preset: PageProfile['preset'];
  orientation: PageProfile['orientation'];
  widthMm: number;
  heightMm: number;
}

/**
 * Walk a small list of candidates and return the first directory that
 * contains a `seevee.json`. Returns null if none match.
 */
export async function resolveWorkspaceRoot(): Promise<string | null> {
  for (const candidate of DEFAULT_ROOT_CANDIDATES) {
    if (candidate === '') continue;
    const absolute = path.isAbsolute(candidate) ? candidate : path.resolve(candidate);
    try {
      const stat = await fs.stat(path.join(absolute, MARKER_FILE));
      if (stat.isFile()) return absolute;
    } catch {
      // continue
    }
  }
  return null;
}

export class NoWorkspaceError extends Error {
  readonly code = 'NO_WORKSPACE' as const;
  constructor() {
    super('Seevee workspace marker (seevee.json) not found in any candidate root');
    this.name = 'NoWorkspaceError';
  }
}

async function readJsonFile(root: string, relativePath: string): Promise<unknown> {
  const absolute = path.join(root, relativePath);
  const raw = await fs.readFile(absolute, 'utf8');
  return JSON.parse(raw) as unknown;
}

function safeRelative(relative: string): string {
  // Workspace documents promise `relativePath` is sanitised by schema,
  // but re-check here to defend against a poisoned workspace that
  // somehow produced an unsanitised index entry.
  if (relative.includes('\0')) throw new Error('NUL byte in relative path');
  if (path.isAbsolute(relative)) throw new Error('absolute path not allowed');
  return relative;
}

/** Load and validate the workspace marker. Throws NoWorkspaceError if missing. */
export async function loadWorkspaceContext(): Promise<WorkspaceContext> {
  const root = await resolveWorkspaceRoot();
  if (root === null) throw new NoWorkspaceError();
  return loadWorkspaceContextAt(root);
}

/** Load and validate the workspace marker from an explicit root. */
export async function loadWorkspaceContextAt(root: string): Promise<WorkspaceContext> {
  let raw: unknown;
  try {
    raw = await readJsonFile(root, MARKER_FILE);
  } catch (err) {
    throw new NoWorkspaceError();
  }
  const parsed = workspaceDocumentSchema.safeParse(raw);
  if (!parsed.success) {
    const failure: ResourceFailure = {
      ok: false,
      kind: 'workspace',
      status: 400,
      reason: 'workspace marker failed schema validation',
      issues: parsed.error.issues,
    };
    throw failure;
  }
  return { root, workspace: parsed.data };
}

/** Resolve a relative resource path against the workspace root. */
export function resolveResourcePath(root: string, relativePath: string): string {
  return path.join(root, safeRelative(relativePath));
}

async function loadByPath<S extends z.ZodTypeAny>(
  root: string,
  relativePath: string,
  kind: ResourceKind,
  schema: S,
): Promise<ResourceResult<z.infer<S>>> {
  let raw: unknown;
  try {
    raw = await readJsonFile(root, relativePath);
  } catch (err) {
    if (err instanceof Error && 'code' in err && err.code === 'ENOENT') {
      return {
        ok: false,
        kind,
        status: 404,
        reason: `${relativePath} not found`,
      };
    }
    const message = err instanceof Error ? err.message : 'read failure';
    return {
      ok: false,
      kind,
      status: 500,
      reason: `${relativePath}: ${message}`,
    };
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    return {
      ok: false,
      kind,
      status: 400,
      reason: `${relativePath} failed ${kind} schema validation`,
      issues: parsed.error.issues,
    };
  }
  return { ok: true, kind, document: parsed.data };
}

export async function loadCv(root: string, relativePath: string): Promise<ResourceResult<CvDocument>> {
  return loadByPath(root, safeRelative(relativePath), 'cv', cvDocumentSchema);
}

export async function loadPresentation(
  root: string,
  relativePath: string,
): Promise<ResourceResult<PresentationDocument>> {
  return loadByPath(root, safeRelative(relativePath), 'presentation', presentationDocumentSchema);
}

export async function loadComments(
  root: string,
  relativePath: string,
): Promise<ResourceResult<CommentsDocument>> {
  return loadByPath(root, safeRelative(relativePath), 'comments', commentsDocumentSchema);
}

export async function loadProvenance(
  root: string,
  relativePath: string,
): Promise<ResourceResult<ProvenanceDocument>> {
  return loadByPath(root, safeRelative(relativePath), 'provenance', provenanceDocumentSchema);
}

export async function loadSource(
  root: string,
  relativePath: string,
): Promise<ResourceResult<SourceDocument>> {
  return loadByPath(root, safeRelative(relativePath), 'source', sourceDocumentSchema);
}

/** List every CV declared by the workspace, with their documents. */
export async function listCvs(
  ctx: WorkspaceContext,
): Promise<ResourceResult<CvDocument>[]> {
  const out: ResourceResult<CvDocument>[] = [];
  const entries = Object.values(ctx.workspace.data.resources.cvs);
  for (const entry of entries) {
    out.push(await loadCv(ctx.root, entry.relativePath));
  }
  return out;
}

/** Build a dashboard-ready summary for a CV document. */
export function summariseCv(document: CvDocument): CvSummary {
  const data = document.data;
  const identity = data.identity;
  const headline = typeof identity.headline === 'string' ? identity.headline : null;
  const display = identity.name.display;
  return {
    id: document.id,
    revision: document.revision,
    updatedAt: document.updatedAt,
    name: display,
    headline,
    locale: data.locale,
    sectionCount: Object.keys(data.sections).length,
  };
}

/** Resolve page geometry (mm) for a presentation document. */
export function resolvePageGeometry(data: PresentationData): ResolvedPageGeometry {
  const presetDims = PAGE_PRESET_DIMENSIONS_MM[data.page.preset];
  const widthMm = data.page.width ?? presetDims.width;
  const heightMm = data.page.height ?? presetDims.height;
  return {
    preset: data.page.preset,
    orientation: data.page.orientation,
    widthMm,
    heightMm,
  };
}