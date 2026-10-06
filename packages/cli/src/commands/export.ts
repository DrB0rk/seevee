/**
 * `seevee export [path] [--template=ID] [--output=path]` — export the active
 * CV to PDF.
 *
 * Spec: `.dev/specs/CLI_INSTALLER.md` §9 (export), §10 (--json, exit 6).
 *
 * The command resolves the workspace's *active* selection from `seevee.json`,
 * renders it through the presentation's template, and writes a PDF. Failures
 * throw the typed errors from `cli.ts` so the runner maps them to the
 * documented exit codes (`ExportError` → 6, `ValidationError` → 4,
 * `WorkspaceNotInitializedError` → 3, `CliUsageError` → 2) rather than
 * returning `ok:false` with a hand-picked code.
 */

import fs from 'node:fs/promises';
import path from 'node:path';

import {
  cvDocumentSchema,
  presentationDocumentSchema,
  templateManifestDocumentSchema,
  workspaceDocumentSchema,
  type CvDocument,
  type PageProfile,
  type PresentationDocument,
  type TemplateManifestDocument,
  type WorkspaceDocument,
} from '@seevee/schema';
import { exportToPdf } from '@seevee/export';

import type { CommandContext, CommandResult } from '../cli.js';
import {
  CliUsageError,
  EXIT,
  ExportError,
  ValidationError,
  WorkspaceNotInitializedError,
} from '../cli.js';
import {
  discoverWorkspace,
  WorkspaceNotFoundError,
} from '../runtime/workspace-discovery.js';

/** Default output location when `--output` is not supplied. */
const DEFAULT_OUTPUT_DIR = 'exports';
const DEFAULT_OUTPUT_NAME = 'cv.pdf';

/** Template manifest filenames a template directory may declare. */
const MANIFEST_FILENAMES: readonly string[] = ['template.json', 'manifest.json'];

type TemplateEntry = WorkspaceDocument['data']['resources']['templates'][string];

export async function runExport(ctx: CommandContext): Promise<CommandResult> {
  const workspaceRoot = await resolveWorkspaceRoot(ctx.positional[0], ctx.cwd);
  const workspace = await readWorkspaceDocument(workspaceRoot);

  const selection = resolveSelection(workspace);
  const cv = await readDocument<CvDocument>(
    workspaceRoot,
    selection.cv.relativePath,
    cvDocumentSchema,
    'cv',
  );
  const presentation = await readDocument<PresentationDocument>(
    workspaceRoot,
    selection.presentation.relativePath,
    presentationDocumentSchema,
    'presentation',
  );

  const templateEntry = requireTemplate(workspace, selection.presentation.templateId, ctx.flags.template);
  const templateRoot = await resolveTemplateRoot(workspaceRoot, templateEntry);
  const manifest = await readTemplateManifest(templateRoot);

  const outputPath = resolveOutputPath(ctx, workspaceRoot, cv);
  await fs.mkdir(path.dirname(outputPath), { recursive: true });

  const pageProfile = pageProfileFrom(presentation);

  // The workspace policy is the user's own switch on forced exports; honour
  // it rather than requiring a duplicate flag that could contradict it.
  const allowForcedExport = workspace.data.policy.allowForceExportWithOverflow;

  const result = await exportToPdf({
    workspaceRoot,
    cvId: workspace.data.active.cvId,
    presentationId: workspace.data.active.presentationId,
    templateArtifactPath: templateRoot,
    outputPath,
    pageProfile,
    ...(allowForcedExport ? { allowForcedExport: true } : {}),
  });

  return {
    ok: true,
    code: EXIT.SUCCESS,
    data: {
      outputPath: result.outputPath,
      pageCount: result.pageCount,
      bytes: result.bytes,
      sha256: result.sha256,
      exportId: result.exportId,
      cvId: workspace.data.active.cvId,
      presentationId: workspace.data.active.presentationId,
      templateId: manifest.templateId,
      versionId: manifest.id,
      startedAt: result.startedAt,
      completedAt: result.completedAt,
    },
    message: `exported ${result.pageCount} page(s) to ${result.outputPath} (${result.bytes} bytes, ${manifest.name})`,
  };
}

// ─── workspace discovery ─────────────────────────────────────────────────

async function resolveWorkspaceRoot(
  explicit: string | undefined,
  cwd: string,
): Promise<string> {
  try {
    return (await discoverWorkspace(explicit, cwd)).root;
  } catch (err) {
    if (err instanceof WorkspaceNotFoundError) {
      throw new WorkspaceNotInitializedError(
        `no Seevee workspace found from ${explicit ?? cwd}`,
      );
    }
    throw err;
  }
}

async function readWorkspaceDocument(root: string): Promise<WorkspaceDocument> {
  const raw = await fs
    .readFile(path.join(root, 'seevee.json'), 'utf8')
    .catch((error: unknown) => {
      throw new WorkspaceNotInitializedError(
        `cannot read ${path.join(root, 'seevee.json')}: ${(error as Error).message}`,
      );
    });
  return parseDocument(workspaceDocumentSchema, raw, 'workspace', 'seevee.json');
}

// ─── active selection ────────────────────────────────────────────────────

interface ActiveSelection {
  readonly cv: WorkspaceDocument['data']['resources']['cvs'][string];
  readonly presentation: WorkspaceDocument['data']['resources']['presentations'][string];
}

/**
 * Resolve the workspace's active CV + presentation. The presentation's own
 * `templateId` is authoritative for which template renders; `--template` can
 * override which registered template to render *with*, but a template the
 * presentation does not reference is a usage error rather than a silent
 * substitution — exporting with a template the workspace never linked would
 * produce a PDF the user did not ask for.
 */
function resolveSelection(workspace: WorkspaceDocument): ActiveSelection {
  const { cvId, presentationId } = workspace.data.active;
  const cv = workspace.data.resources.cvs[cvId];
  if (cv === undefined) {
    throw new ValidationError(
      `workspace.active.cvId='${cvId}' is not registered in resources.cvs`,
    );
  }
  const presentation = workspace.data.resources.presentations[presentationId];
  if (presentation === undefined) {
    throw new ValidationError(
      `workspace.active.presentationId='${presentationId}' is not registered in resources.presentations`,
    );
  }
  return { cv, presentation };
}

function requireTemplate(
  workspace: WorkspaceDocument,
  presentationTemplateId: string,
  override: string | null,
): TemplateEntry {
  const templateId = override ?? presentationTemplateId;
  const entry = workspace.data.resources.templates[templateId];
  if (entry === undefined) {
    throw new CliUsageError(
      `template '${templateId}' is not registered in this workspace`,
    );
  }
  if (override !== null && override !== presentationTemplateId) {
    throw new CliUsageError(
      `--template '${override}' does not match the active presentation's template ` +
        `'${presentationTemplateId}'; activate it with \`seevee template activate\` first`,
    );
  }
  return entry;
}

/**
 * Resolve a registered template's root directory. `relativePath` may point at
 * the version directory or directly at its manifest.
 */
async function resolveTemplateRoot(
  workspaceRoot: string,
  entry: TemplateEntry,
): Promise<string> {
  const registered = path.resolve(workspaceRoot, entry.relativePath);
  const stat = await fs.stat(registered).catch(() => null);
  if (stat === null) {
    throw new WorkspaceNotInitializedError(
      `template path does not exist: ${entry.relativePath}`,
    );
  }
  return stat.isDirectory() ? registered : path.dirname(registered);
}

async function readTemplateManifest(
  templateRoot: string,
): Promise<TemplateManifestDocument> {
  for (const filename of MANIFEST_FILENAMES) {
    const candidate = path.join(templateRoot, filename);
    const raw = await fs.readFile(candidate, 'utf8').catch(() => null);
    if (raw === null) continue;
    return parseDocument(
      templateManifestDocumentSchema,
      raw,
      'template-manifest',
      candidate,
    );
  }
  throw new ExportError(
    `template at '${templateRoot}' has no ${MANIFEST_FILENAMES.join(' or ')} to render`,
  );
}

// ─── document reads ──────────────────────────────────────────────────────

async function readDocument<T>(
  workspaceRoot: string,
  relativePath: string,
  schema: { safeParse(input: unknown): { success: true; data: T } | { success: false; error: { issues: readonly { path: PropertyKey[]; message: string }[] } } },
  label: string,
): Promise<T> {
  const absolute = path.resolve(workspaceRoot, relativePath);
  const raw = await fs.readFile(absolute, 'utf8').catch((error: unknown) => {
    throw new ValidationError(
      `cannot read ${label} at '${relativePath}': ${(error as Error).message}`,
    );
  });
  return parseDocument(schema, raw, label, absolute);
}

/**
 * Parse and schema-validate one document, reporting the first failing field so
 * the user can fix it in one pass instead of guessing.
 */
function parseDocument<T>(
  schema: { safeParse(input: unknown): { success: true; data: T } | { success: false; error: { issues: readonly { path: PropertyKey[]; message: string }[] } } },
  raw: string,
  label: string,
  source: string,
): T {
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch (error) {
    throw new ValidationError(
      `invalid JSON in ${label} '${source}': ${(error as Error).message}`,
    );
  }
  const parsed = schema.safeParse(json);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const where = issue === undefined ? '<root>' : issue.path.map(String).join('.');
    const what = issue?.message ?? 'unknown Zod issue';
    throw new ValidationError(
      `${label} '${source}' failed schema validation at '${where}': ${what}`,
    );
  }
  return parsed.data;
}

// ─── output ──────────────────────────────────────────────────────────────

/**
 * Resolve the PDF destination. `--output`/`-o` wins; a directory is accepted
 * and gets the default filename appended so `--output ./out/` behaves the way
 * a shell user expects.
 */
function resolveOutputPath(
  ctx: CommandContext,
  workspaceRoot: string,
  cv: CvDocument,
): string {
  const flag = ctx.flags.output;
  const defaultDir = path.join(workspaceRoot, DEFAULT_OUTPUT_DIR);

  if (flag === null) {
    const slug = slugify(cv.id);
    return path.resolve(defaultDir, `${slug ?? DEFAULT_OUTPUT_NAME.replace(/\.pdf$/, '')}.pdf`);
  }

  const resolved = path.resolve(ctx.cwd, flag);
  if (flag.endsWith(path.sep) || flag.endsWith('/')) {
    return path.join(resolved, DEFAULT_OUTPUT_NAME);
  }
  // A path with no extension is almost always a directory the user meant to
  // create; putting the PDF inside it beats writing a extensionless file.
  if (path.extname(resolved) === '') {
    return path.join(resolved, DEFAULT_OUTPUT_NAME);
  }
  return resolved;
}

function slugify(value: string): string {
  const slug = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, '-')
    .replace(/^-+|-+$/gu, '');
  return slug;
}

/**
 * The presentation's page block *is* the schema `PageProfile`; pass it
 * through unchanged so the rendered document and the PDF's physical page size
// cannot drift apart.
 */
function pageProfileFrom(presentation: PresentationDocument): PageProfile {
  return presentation.data.page;
}