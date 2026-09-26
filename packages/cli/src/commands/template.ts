/**
 * `seevee template <subcommand>` — the template authoring lifecycle.
 *
 * Spec: `.dev/specs/TEMPLATE_AUTHORING.md` §2 (directory contract), §5
 * (compilation lifecycle), §13 (style presets).
 *
 * The dashboard renders the *active* template version named in
 * `seevee.json`. Editing a file under a non-active version directory changes
 * nothing on screen, which is the single most common reason an agent
 * "cannot find" its style edit. This command makes the lifecycle explicit
 * and mechanical:
 *
 *   seevee template list
 *   seevee template draft     --template <id> [--draft <version-id>]
 *   seevee template validate  --template <id> --draft <version-id>
 *   seevee template compile   --template <id> --draft <version-id>
 *   seevee template activate  --template <id> --draft <version-id>
 *
 * `activate` re-validates before repointing the workspace, so a broken
 * template can never become the version the dashboard renders.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import type { z } from 'zod';

import { workspaceDocumentSchema } from '@seevee/schema';
import { compileTemplate, runPolicyScan, validateManifest } from '@seevee/template-compiler';

import type { CommandContext, CommandResult } from '../cli.js';
import { CliUsageError, EXIT, WorkspaceNotInitializedError } from '../cli.js';
import { discoverWorkspace } from '../runtime/workspace-discovery.js';

const SUBCOMMANDS = ['list', 'draft', 'validate', 'compile', 'activate'] as const;
type Subcommand = (typeof SUBCOMMANDS)[number];

type WorkspaceDocument = z.infer<typeof workspaceDocumentSchema>;
type TemplateEntry = WorkspaceDocument['data']['resources']['templates'][string];

/** Where compiled artifacts land, relative to the workspace root. */
const ARTIFACT_DIR = path.join('.seevee', 'artifacts');

/** Directories never copied into a draft or scanned as template source. */
const IGNORED_DIRECTORIES = new Set(['node_modules', '.astro', 'dist', '.git', '.seevee']);

function isNotFound(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT';
}

async function pathExists(target: string): Promise<boolean> {
  return fs.stat(target).then(() => true, () => false);
}

async function readWorkspaceDocument(root: string): Promise<WorkspaceDocument> {
  const raw = await fs.readFile(path.join(root, 'seevee.json'), 'utf8').catch((error: unknown) => {
    if (isNotFound(error)) throw new WorkspaceNotInitializedError('no seevee.json in this workspace');
    throw error;
  });
  const parsed = workspaceDocumentSchema.safeParse(JSON.parse(raw));
  if (!parsed.success) {
    throw new WorkspaceNotInitializedError('seevee.json failed workspace schema validation');
  }
  return parsed.data;
}

function requireTemplateId(ctx: CommandContext): string {
  const templateId = ctx.flags.template;
  if (templateId === null || templateId.length === 0) {
    throw new CliUsageError('--template <id> is required');
  }
  return templateId;
}

function requireTemplate(ctx: CommandContext, workspace: WorkspaceDocument): TemplateEntry {
  const templateId = requireTemplateId(ctx);
  const entry = workspace.data.resources.templates[templateId];
  if (entry === undefined) {
    throw new CliUsageError(`template '${templateId}' is not registered in this workspace`);
  }
  return entry;
}

/**
 * Resolve the directory holding a template version. A registered
 * `relativePath` may point at the version directory or at its manifest; both
 * resolve to the same root.
 */
async function resolveVersionRoot(root: string, entry: TemplateEntry): Promise<string> {
  const registered = path.resolve(root, entry.relativePath);
  const stat = await fs.stat(registered).catch(() => null);
  if (stat === null) {
    throw new WorkspaceNotInitializedError(`template path does not exist: ${entry.relativePath}`);
  }
  return stat.isDirectory() ? registered : path.dirname(registered);
}

function versionRootFor(workspaceRoot: string, templateId: string, versionId: string): string {
  return path.join(workspaceRoot, 'templates', templateId, versionId);
}

async function listSourceFiles(dir: string, base = dir): Promise<string[]> {
  const out: string[] = [];
  const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    if (entry.name.startsWith('.') || IGNORED_DIRECTORIES.has(entry.name)) continue;
    const absolute = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...await listSourceFiles(absolute, base));
    } else if (entry.isFile()) {
      out.push(path.relative(base, absolute));
    }
  }
  return out.sort();
}

async function copyTree(from: string, to: string): Promise<number> {
  const files = await listSourceFiles(from);
  for (const relative of files) {
    const target = path.join(to, relative);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.copyFile(path.join(from, relative), target);
  }
  return files.length;
}

/**
 * Next unused version id for a template, following whatever numbering the
 * workspace already uses: `v1` -> `v2`, `tpl_minimal_v1` -> `tpl_minimal_v2`.
 * Ids must stay >= 3 characters to satisfy the shared id schema.
 */
async function nextDraftId(workspaceRoot: string, templateId: string, currentVersionId: string): Promise<string> {
  const parent = path.join(workspaceRoot, 'templates', templateId);
  const existing = new Set(
    (await fs.readdir(parent, { withFileTypes: true }).catch(() => []))
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name),
  );
  const trailing = /^(.*?)(\d+)$/.exec(currentVersionId);
  const prefix = trailing?.[1] !== undefined && trailing[1].length > 0 ? trailing[1] : 'version';
  const suffixWidth = Math.max(trailing?.[2]?.length ?? 1, 3 - prefix.length);
  let index = trailing === null ? 2 : Number.parseInt(trailing[2] ?? '2', 10) + 1;
  for (; index < 1000; index += 1) {
    const candidate = `${prefix}${String(index).padStart(suffixWidth, '0')}`;
    if (!existing.has(candidate)) return candidate;
  }
  throw new CliUsageError(`could not allocate a draft id for template '${templateId}'`);
}

async function readDraftManifest(draftRoot: string) {
  const raw = await fs.readFile(path.join(draftRoot, 'template.json'), 'utf8').catch((error: unknown) => {
    if (isNotFound(error)) throw new CliUsageError('draft is missing template.json');
    throw error;
  });
  return validateManifest(JSON.parse(raw));
}

async function requireWorkspaceRoot(ctx: CommandContext): Promise<string> {
  const discovered = await discoverWorkspace(undefined, ctx.cwd).catch(() => null);
  if (discovered === null) {
    throw new WorkspaceNotInitializedError('no Seevee workspace found from the current directory');
  }
  return discovered.root;
}

/** Resolve the draft a lifecycle subcommand should act on. */
async function resolveTarget(ctx: CommandContext): Promise<{
  workspaceRoot: string;
  templateId: string;
  entry: TemplateEntry;
  draftId: string;
  draftRoot: string;
}> {
  const workspaceRoot = await requireWorkspaceRoot(ctx);
  const workspace = await readWorkspaceDocument(workspaceRoot);
  const entry = requireTemplate(ctx, workspace);
  const templateId = entry.id;
  const draftId = ctx.flags.draft ?? entry.currentVersionId;
  return { workspaceRoot, templateId, entry, draftId, draftRoot: versionRootFor(workspaceRoot, templateId, draftId) };
}

async function runList(ctx: CommandContext): Promise<CommandResult> {
  const workspaceRoot = await requireWorkspaceRoot(ctx);
  const workspace = await readWorkspaceDocument(workspaceRoot);
  const templates = Object.values(workspace.data.resources.templates).map((entry) => ({
    id: entry.id,
    currentVersionId: entry.currentVersionId,
    relativePath: entry.relativePath,
    styleSheet: path.posix.join(entry.relativePath, 'styles', 'dashboard.css'),
  }));
  return {
    ok: true,
    code: EXIT.SUCCESS,
    data: { templates },
    message: templates.length === 0
      ? 'no templates registered in this workspace'
      : `${templates.length} template(s) registered`,
  };
}

async function runDraft(ctx: CommandContext): Promise<CommandResult> {
  const { workspaceRoot, templateId, entry } = await resolveTarget(ctx);
  const draftId = ctx.flags.draft ?? await nextDraftId(workspaceRoot, templateId, entry.currentVersionId);
  if (!/^[A-Za-z][A-Za-z0-9_-]*$/.test(draftId)) {
    throw new CliUsageError(`--draft must start with a letter and contain only [A-Za-z0-9_-] (got '${draftId}')`);
  }
  const draftRoot = versionRootFor(workspaceRoot, templateId, draftId);
  if (await pathExists(draftRoot)) {
    throw new CliUsageError(`draft '${draftId}' already exists for template '${templateId}'`);
  }
  const sourceRoot = await resolveVersionRoot(workspaceRoot, entry);
  const files = await copyTree(sourceRoot, draftRoot);
  return {
    ok: true,
    code: EXIT.SUCCESS,
    data: {
      templateId,
      draftId,
      draftRoot,
      seededFrom: sourceRoot,
      files,
      styleSheet: path.join(draftRoot, 'styles', 'dashboard.css'),
    },
    message: `draft ${templateId}/${draftId} seeded with ${files} file(s)`,
  };
}

async function runValidate(ctx: CommandContext): Promise<CommandResult> {
  const { templateId, draftId, draftRoot } = await resolveTarget(ctx);
  const manifest = await readDraftManifest(draftRoot);
  const scan = runPolicyScan(draftRoot);
  return {
    ok: true,
    code: EXIT.SUCCESS,
    data: {
      templateId,
      draftId,
      manifestValid: manifest.templateId === templateId,
      scannedFiles: scan.files,
      scannedImports: scan.imports,
    },
    message: manifest.templateId === templateId
      ? `template ${templateId}/${draftId} passed manifest and policy checks`
      : `manifest declares templateId '${manifest.templateId}' but lives under '${templateId}'`,
  };
}

async function runCompile(ctx: CommandContext): Promise<CommandResult> {
  const { workspaceRoot, templateId, draftId, draftRoot } = await resolveTarget(ctx);
  const manifest = await readDraftManifest(draftRoot);
  const fixtureDir = path.join(draftRoot, 'fixtures');
  if (!(await pathExists(fixtureDir))) {
    throw new CliUsageError(`draft ${templateId}/${draftId} has no fixtures/ directory to compile against`);
  }
  const artifact = await compileTemplate({
    sourceRoot: draftRoot,
    manifest,
    fixtureDir,
    outputRoot: path.join(workspaceRoot, ARTIFACT_DIR, templateId, draftId),
  });
  return {
    ok: true,
    code: EXIT.SUCCESS,
    data: {
      templateId,
      draftId,
      artifactId: artifact.artifactId,
      compiledAt: artifact.compiledAt,
      pages: artifact.pages,
      hasOverflow: artifact.hasOverflow,
      diagnostics: artifact.diagnostics,
    },
    message: `compiled ${templateId}/${draftId} into artifact ${artifact.artifactId}`,
  };
}

async function runActivate(ctx: CommandContext): Promise<CommandResult> {
  const { workspaceRoot, templateId, entry, draftId, draftRoot } = await resolveTarget(ctx);
  if (draftId === entry.currentVersionId) {
    return {
      ok: true,
      code: EXIT.SUCCESS,
      data: { templateId, activatedVersionId: draftId, changed: false },
      message: `template ${templateId} already active at ${draftId}`,
    };
  }
  // Never activate something that cannot be read back: an invalid or unsafe
  // manifest must not become the version the dashboard renders.
  await readDraftManifest(draftRoot);
  runPolicyScan(draftRoot);

  const workspacePath = path.join(workspaceRoot, 'seevee.json');
  const document = await readWorkspaceDocument(workspaceRoot);
  const relativePath = path.posix.join('templates', templateId, draftId);
  const updated: WorkspaceDocument = {
    ...document,
    data: {
      ...document.data,
      resources: {
        ...document.data.resources,
        templates: {
          ...document.data.resources.templates,
          [templateId]: { id: templateId, relativePath, currentVersionId: draftId, updatedAt: new Date().toISOString() },
        },
      },
    },
  };
  await fs.writeFile(workspacePath, `${JSON.stringify(updated, null, 2)}\n`, 'utf8');
  return {
    ok: true,
    code: EXIT.SUCCESS,
    data: { templateId, activatedVersionId: draftId, relativePath, changed: true },
    message: `activated ${templateId}/${draftId}`,
  };
}

const HANDLERS: Readonly<Record<Subcommand, (ctx: CommandContext) => Promise<CommandResult>>> = {
  list: runList,
  draft: runDraft,
  validate: runValidate,
  compile: runCompile,
  activate: runActivate,
};

export async function runTemplate(ctx: CommandContext): Promise<CommandResult> {
  const [subcommand, ...rest] = ctx.positional;
  if (subcommand === undefined || subcommand === 'help' || ctx.flags.help) {
    return {
      ok: true,
      code: EXIT.SUCCESS,
      data: {
        subcommands: SUBCOMMANDS,
        usage: 'seevee template <list|draft|validate|compile|activate> --template <id> [--draft <version-id>]',
      },
      message: 'seevee template list | draft | validate | compile | activate',
    };
  }
  if (rest.length > 0) {
    throw new CliUsageError(`unexpected argument after '${subcommand}': ${rest.join(' ')}`);
  }
  const handler = HANDLERS[subcommand as Subcommand];
  if (handler === undefined) {
    throw new CliUsageError(`unknown template subcommand: ${subcommand}`);
  }
  return handler(ctx);
}
