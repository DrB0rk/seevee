/**
 * Template root resolution for the Studio.
 *
 * A workspace registers a template by `resources.templates[id].relativePath`
 * and every presentation pins a concrete version through `data.template.versionId`.
 * Turning that pair into a directory the renderer can execute is the job here,
 * because the two layouts in the wild differ:
 *
 *   - flat       — `relativePath` *is* the version root
 *                  (`templates/tpl_minimal/template.json`).
 *   - versioned  — the version lives one level down
 *                  (`templates/classic/v1/template.json`).
 *
 * Guessing a layout produces a template that renders the wrong source, so the
 * resolver instead asks each candidate directory for its own `template.json` and
 * keeps the one whose manifest actually declares the requested
 * `templateId`/`versionId`. Identity beats layout: a manifest that claims to be
 * the requested version is authoritative regardless of where it sits.
 *
 * Every candidate is confined to the workspace root with `realpath`, so a
 * poisoned `relativePath` (`../../etc`) cannot make the renderer execute a
 * directory outside the workspace.
 */
import fs from 'node:fs/promises';
import path from 'node:path';

import { templateManifestDocumentSchema, type TemplateManifestDocument } from '@seevee/schema';

import { resolveResourcePath, type WorkspaceContext } from './workspace.js';

/** A version directory the renderer can execute, plus its validated manifest. */
export interface ResolvedTemplateRoot {
  /** Absolute path containing `template.json` and the template's source. */
  readonly root: string;
  /** Manifest declared by that `template.json`. */
  readonly manifest: TemplateManifestDocument;
}

/**
 * Resolve the directory holding `versionId` of `templateId`.
 *
 * Throws when the template is unregistered, when no on-disk manifest declares
 * that identity, or when the manifest is malformed — each with a distinct
 * message so the API layer can map it to a useful status without re-reading
 * the workspace.
 */
export async function resolveTemplateRoot(
  ctx: WorkspaceContext,
  templateId: string,
  versionId: string,
): Promise<ResolvedTemplateRoot> {
  const entry = ctx.workspace.data.resources.templates[templateId];
  if (entry === undefined) {
    throw new Error(`template ${templateId} is not registered in this workspace`);
  }
  const registered = resolveResourcePath(ctx.root, entry.relativePath);
  const candidates = await candidateManifestPaths(ctx.root, registered);
  const malformed: string[] = [];
  for (const manifestPath of candidates) {
    const parsed = await readManifest(manifestPath);
    if (parsed === null) continue;
    if ('error' in parsed) {
      malformed.push(`${path.relative(ctx.root, manifestPath)}: ${parsed.error}`);
      continue;
    }
    if (parsed.document.templateId !== templateId || parsed.document.id !== versionId) continue;
    return { root: path.dirname(manifestPath), manifest: parsed.document };
  }
  const detail = malformed.length > 0 ? ` (${malformed.join('; ')})` : '';
  throw new Error(
    `template version ${templateId}/${versionId} was not found under ${entry.relativePath}${detail}`,
  );
}

/**
 * Candidate manifest paths, nearest-first, all confined to the workspace.
 *
 * The registered path may itself be a directory or a manifest file (`init`
 * registers `templates/local/classic/template.json`), so both spellings seed
 * the search. Versioned layouts append `<versionId>`; the flat layout already
 * resolves on the first hit.
 */
async function candidateManifestPaths(workspaceRoot: string, registered: string): Promise<string[]> {
  const realRoot = await fs.realpath(workspaceRoot);
  const seeds: string[] = [];
  const registeredStat = await fs.stat(registered).catch(() => null);
  if (registeredStat?.isDirectory()) seeds.push(path.join(registered, 'template.json'));
  else if (registeredStat?.isFile()) seeds.push(registered);
  if (registeredStat === null) return [];

  for (const seed of seeds) {
    const versionDir = path.join(path.dirname(seed), path.basename(seed, '.json'));
    if (seed.endsWith('.json')) {
      // `…/classic/template.json` → the version directory may be a sibling.
      const parent = path.dirname(seed);
      for (const child of await fs.readdir(parent, { withFileTypes: true }).catch(() => [])) {
        if (child.isDirectory()) seeds.push(path.join(parent, child.name, 'template.json'));
      }
      break;
    }
    const children = await fs.readdir(versionDir, { withFileTypes: true }).catch(() => []);
    for (const child of children) {
      if (child.isDirectory()) seeds.push(path.join(versionDir, child.name, 'template.json'));
    }
  }

  const unique = Array.from(new Set(seeds));
  const out: string[] = [];
  for (const candidate of unique) {
    const safe = await confine(realRoot, candidate);
    if (safe !== null) out.push(safe);
  }
  return out;
}

/**
 * Real path of `candidate` when it stays inside `realRoot`, else null.
 *
 * `realpath` is what makes the containment check meaningful — a symlink inside
 * the workspace can point outside it, and resolving first is what detects that.
 */
async function confine(realRoot: string, candidate: string): Promise<string | null> {
  const real = await fs.realpath(candidate).catch(() => null);
  if (real === null) return null;
  const relative = path.relative(realRoot, real);
  if (relative.startsWith('..') || path.isAbsolute(relative)) return null;
  return real;
}

type ManifestRead =
  | { readonly document: TemplateManifestDocument }
  | { readonly error: string };

/** Read and schema-validate one manifest; null when the file is absent. */
async function readManifest(manifestPath: string): Promise<ManifestRead | null> {
  let raw: string;
  try {
    raw = await fs.readFile(manifestPath, 'utf8');
  } catch {
    return null;
  }
  const json = JSON.parse(raw) as unknown;
  const parsed = templateManifestDocumentSchema.safeParse(json);
  if (!parsed.success) return { error: `invalid template manifest (${parsed.error.issues.length} issues)` };
  return { document: parsed.data };
}