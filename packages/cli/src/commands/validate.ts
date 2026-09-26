/**
 * `seevee validate [file|directory]` — structural + semantic validation.
 *
 * Spec: `.dev/specs/CLI_INSTALLER.md` §9 (validate), §10 (--json).
 *
 * Modes:
 *   - no path: validate every JSON document under <workspace>/{cvs,
 *     provenance, comments, presentations};
 *   - file: validate that single document;
 *   - directory: validate every *.json under that directory recursively.
 *
 * Structural checks use the Zod schemas in `@seevee/schema`. Cross-resource
 * semantic checks run only when validating a workspace as a whole.
 *
 * Never throws for invalid input — returns ok=false in the result; the CLI
 * runner maps that to exit code 4.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

import type { CommandContext, CommandResult } from '../cli.js';
import {
  ValidationError,
  WorkspaceNotInitializedError,
} from '../cli.js';
import {
  discoverWorkspace,
  WorkspaceNotFoundError,
  type DiscoveredWorkspace,
} from '../runtime/workspace-discovery.js';
import {
  workspaceDocumentSchema,
  cvDocumentSchema,
  provenanceDocumentSchema,
  commentsDocumentSchema,
  presentationDocumentSchema,
  sourceDocumentSchema,
  changeSetDocumentSchema,
  templateManifestDocumentSchema,
  stylePresetDocumentSchema,
  agentRunDocumentSchema,
  renderDiagnosticsDocumentSchema,
  validateWorkspaceSemantics,
  type SemanticIssue,
} from '@seevee/schema';

type SafeParseFn = (input: unknown) =>
  | { success: true }
  | { success: false; error: { issues: readonly unknown[] } };

const TYPE_TO_SCHEMA: Readonly<Record<string, { kind: string; safe: SafeParseFn }>> = {
  'seevee.workspace': { kind: 'workspace', safe: (i) => workspaceDocumentSchema.safeParse(i) },
  'seevee.cv': { kind: 'cv', safe: (i) => cvDocumentSchema.safeParse(i) },
  'seevee.provenance': { kind: 'provenance', safe: (i) => provenanceDocumentSchema.safeParse(i) },
  'seevee.comments': { kind: 'comments', safe: (i) => commentsDocumentSchema.safeParse(i) },
  'seevee.presentation': { kind: 'presentation', safe: (i) => presentationDocumentSchema.safeParse(i) },
  'seevee.source': { kind: 'source', safe: (i) => sourceDocumentSchema.safeParse(i) },
  'seevee.change-set': { kind: 'change-set', safe: (i) => changeSetDocumentSchema.safeParse(i) },
  'seevee.template-manifest': { kind: 'template-manifest', safe: (i) => templateManifestDocumentSchema.safeParse(i) },
  'seevee.style-preset': { kind: 'style-preset', safe: (i) => stylePresetDocumentSchema.safeParse(i) },
  'seevee.agent-run': { kind: 'agent-run', safe: (i) => agentRunDocumentSchema.safeParse(i) },
  'seevee.render-diagnostics': { kind: 'render-diagnostics', safe: (i) => renderDiagnosticsDocumentSchema.safeParse(i) },
};

interface FileValidation {
  ok: boolean;
  kind: string | null;
  issues: readonly unknown[];
  message?: string;
}

export interface ValidateResourceOptions {
  file: string;
}

/**
 * Validate a single JSON file. Public for `init.ts` (re-validation pass) and
 * for direct CLI invocations with an explicit path. Returns ok=false for
 * unreadable, invalid-JSON, or schema-mismatched files (never throws).
 */
export async function validateResource(
  options: ValidateResourceOptions,
): Promise<FileValidation> {
  let raw: string;
  try {
    raw = await fs.readFile(options.file, 'utf8');
  } catch (err) {
    return {
      ok: false,
      kind: null,
      issues: [{ error: 'unreadable', message: (err as Error).message }],
      message: `cannot read ${options.file}`,
    };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    return {
      ok: false,
      kind: null,
      issues: [{ error: 'invalid-json', message: (err as Error).message }],
      message: `invalid JSON in ${options.file}`,
    };
  }

  const envelopeType =
    parsed && typeof parsed === 'object'
      ? ('kind' in parsed
          ? (parsed as Record<string, unknown>).kind
          : 'type' in parsed
            ? (parsed as Record<string, unknown>).type
            : undefined)
      : undefined;
  const entry =
    typeof envelopeType === 'string' ? TYPE_TO_SCHEMA[envelopeType] : undefined;

  if (entry === undefined) {
    return {
      ok: true,
      kind: null,
      issues: [],
      message: `skip: unknown document type "${String(envelopeType)}"`,
    };
  }

  const structural = entry.safe(parsed);
  if (!structural.success) {
    return {
      ok: false,
      kind: entry.kind,
      issues: structural.error.issues,
      message: `${entry.kind} document failed schema validation (${structural.error.issues.length} issue(s))`,
    };
  }
  return { ok: true, kind: entry.kind, issues: [] };
}

export async function runValidate(ctx: CommandContext): Promise<CommandResult> {
  const explicit = ctx.positional[0];
  let ws: DiscoveredWorkspace;
  try {
    ws = await discoverWorkspace(explicit, ctx.cwd);
  } catch (err) {
    if (err instanceof WorkspaceNotFoundError) {
      throw new WorkspaceNotInitializedError(`no workspace at ${explicit ?? ctx.cwd}`);
    }
    throw err;
  }

  const targets = await collectValidateTargets(ws, explicit);
  if (targets.length === 0) {
    return {
      ok: true,
      code: 0,
      data: { ok: true, files: [], semantic: [] },
      message: ctx.flags.json
        ? undefined
        : 'seevee validate: no canonical resources to validate',
    };
  }

  const results: Array<{ file: string; validation: FileValidation }> = [];
  for (const file of targets) {
    const validation = await validateResource({ file });
    results.push({ file, validation });
  }

  // Cross-resource semantic validation (only for whole-workspace mode).
  let semanticIssues: SemanticIssue[] = [];
  if (explicit === undefined || explicit === '') {
    semanticIssues = await runSemanticPass(ws);
  }
  const semanticFailed = semanticIssues.length > 0;

  const failed = results.filter((r) => !r.validation.ok);
  const ok = failed.length === 0 && !semanticFailed;

  if (!ok) {
    const issues = results.flatMap((r) =>
      r.validation.issues.map((i) => ({ file: r.file, issue: i })),
    );
    const totalFailures = failed.length + (semanticFailed ? semanticIssues.length : 0);
    throw new ValidationError(
      `${totalFailures} validation issue(s) across ${targets.length} resource(s)`,
      [...issues, ...semanticIssues.map((i) => ({ semantic: i }))],
    );
  }

  return {
    ok: true,
    code: 0,
    data: {
      ok: true,
      files: results.map((r) => ({
        file: r.file,
        kind: r.validation.kind,
        ok: true,
      })),
      semantic: semanticIssues,
    },
    message: ctx.flags.json
      ? undefined
      : `seevee validate: ${results.length} resource(s) ok${semanticIssues.length === 0 ? '' : ` (+ ${semanticIssues.length} semantic issue(s))`}`,
  };
}

async function runSemanticPass(ws: DiscoveredWorkspace): Promise<SemanticIssue[]> {
  // The semantic pass only sees what it loads, so it must load the same
  // documents the dashboard validates — the ones `seevee.json` registers.
  // Looking for fixed filenames here made the pass a silent no-op: it
  // reported "0 semantic issues" for workspaces that were in fact broken,
  // which is worse than no check at all.
  const ctx = await loadSemanticContext({ ws });
  return validateWorkspaceSemantics(ctx);
}

interface SemanticContextInputs {
  ws: DiscoveredWorkspace;
}

type SemanticContext = Parameters<typeof validateWorkspaceSemantics>[0];
type SemanticDocument<K extends keyof SemanticContext> = NonNullable<SemanticContext[K]>;

async function readDocument<T>(file: string): Promise<T | null> {
  try {
    return JSON.parse(await fs.readFile(file, 'utf8')) as T;
  } catch {
    return null;
  }
}

async function loadSemanticContext(input: SemanticContextInputs): Promise<SemanticContext> {
  const { ws } = input;
  const workspace = await readDocument<SemanticDocument<'workspace'>>(ws.workspaceFile);
  if (workspace === null) return {};

  const resources = workspace.data.resources;
  const cvEntry = workspace.data.active.cvId === null ? undefined : resources.cvs[workspace.data.active.cvId];
  if (cvEntry === undefined) return { workspace };
  const cv = await readDocument<SemanticDocument<'cv'>>(path.join(ws.root, cvEntry.relativePath));
  if (cv === null) return { workspace };

  const presentationId = workspace.data.active.presentationId;
  const presentationEntry = presentationId === null ? undefined : resources.presentations[presentationId];
  const provenanceEntry = Object.values(resources.provenance).find((entry) => entry.cvId === cv.id);
  const commentsEntry = Object.values(resources.comments).find((entry) => entry.cvId === cv.id);
  const [presentation, provenance, comments] = await Promise.all([
    presentationEntry === undefined ? null : readDocument<SemanticDocument<'presentation'>>(path.join(ws.root, presentationEntry.relativePath)),
    provenanceEntry === undefined ? null : readDocument<SemanticDocument<'provenance'>>(path.join(ws.root, provenanceEntry.relativePath)),
    commentsEntry === undefined ? null : readDocument<SemanticDocument<'comments'>>(path.join(ws.root, commentsEntry.relativePath)),
  ]);
  return {
    workspace,
    cv,
    ...(presentation === null ? {} : { presentation }),
    ...(provenance === null ? {} : { provenance }),
    ...(comments === null ? {} : { comments }),
  };
}

async function collectValidateTargets(
  ws: DiscoveredWorkspace,
  explicit: string | undefined,
): Promise<string[]> {
  if (explicit !== undefined && explicit !== '') {
    const abs = path.isAbsolute(explicit) ? explicit : path.join(process.cwd(), explicit);
    const stat = await fs.stat(abs);
    if (stat.isDirectory()) {
      return await collectJsonsUnder(abs);
    }
    return [abs];
  }
  const dirs = ['cvs', 'provenance', 'comments', 'presentations'];
  const files: string[] = [];
  for (const d of dirs) {
    const dir = path.join(ws.root, d);
    try {
      const entries = await fs.readdir(dir);
      for (const entry of entries) {
        if (entry.endsWith('.json')) files.push(path.join(dir, entry));
      }
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
    }
  }
  return files;
}

async function collectJsonsUnder(dir: string): Promise<string[]> {
  const files: string[] = [];
  const entries = await fs.readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await collectJsonsUnder(p)));
    } else if (entry.name.endsWith('.json')) {
      files.push(p);
    }
  }
  return files;
}
