// Artifact copy + hash + metadata write.
//
// The compiler writes an immutable artifact directory under `outputRoot`
// named after the sha256 of the canonical source bytes. The artifact is
// content-addressable: re-running the compile with identical source yields
// the same id, so the workspace layer can dedupe cleanly.
//
// Files copied: every regular file under `sourceRoot`, minus the noise
// patterns listed in `IGNORE_PATTERNS`. We compute the hash over the
// canonical JSON form of those files (sorted paths, sorted keys) so the
// id is deterministic across filesystems and git states.
//
// After the copy we write `compile-metadata.json` containing every input
// plus the diagnostics emitted by each stage. The metadata file is the
// artefact the workspace registry indexes.

import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { extname, join, relative, resolve } from 'node:path';

import { createHash } from 'node:crypto';

import type { TemplateManifestDocument } from '@seevee/schema';

import type { CompileDiagnostic, CompileStage } from './types.js';
import { CompileError } from './errors.js';

export interface BuildArtifactOptions {
  readonly sourceRoot: string;
  readonly outputRoot: string;
  readonly manifest: TemplateManifestDocument;
  readonly diagnostics: readonly CompileDiagnostic[];
  readonly pages: number;
  readonly hasOverflow: boolean;
}

export interface BuildArtifactOutcome {
  readonly artifactId: string;
  readonly manifestHash: string;
  readonly artifactDir: string;
  readonly compiledAt: string;
}

/**
 * Directories and file globs excluded from the copied artifact. The list is
 * deliberately narrow — anything template source authors might leave
 * behind from CI runs or local experiments is dropped.
 */
const IGNORE_DIRS: ReadonlySet<string> = new Set([
  'node_modules',
  '.git',
  '.next',
  '.turbo',
  '.astro',
  'dist',
  'coverage',
]);

const IGNORE_FILE_SUFFIXES: readonly string[] = Object.freeze([
  '.log',
]);

/**
 * Build the artifact directory. Overwrites any pre-existing directory with
 * the same id (the workspace is expected to dedupe by id; a stale leftover
 * from an interrupted compile is fine to wipe).
 */
export async function buildArtifact(
  options: BuildArtifactOptions,
): Promise<BuildArtifactOutcome> {
  const sourceRoot = resolve(options.sourceRoot);
  const outputRoot = resolve(options.outputRoot);

  if (!existsSync(sourceRoot) || !statSync(sourceRoot).isDirectory()) {
    throw new CompileError('build', `source root does not exist: ${sourceRoot}`, {
      source: sourceRoot,
    });
  }

  const { files, hashBytes } = await collectAndHash(sourceRoot);
  const artifactId = sha256Hex(hashBytes);

  // Manifest hash: hash the canonical JSON of the manifest so two compiles
  // with equivalent manifests (different key order) produce the same id.
  const manifestHash = sha256Hex(Buffer.from(canonicalJson(options.manifest), 'utf8'));

  const artifactDir = join(outputRoot, artifactId);
  await safeMkdir(artifactDir);

  // Wipe a previous run with the same id.
  for (const entry of readdirSync(artifactDir)) {
    rmSync(join(artifactDir, entry), { recursive: true, force: true });
  }

  for (const file of files) {
    const rel = relative(sourceRoot, file.absPath);
    const dest = join(artifactDir, rel);
    await safeMkdir(join(dest, '..'));
    copyFileSync(file.absPath, dest);
  }

  const compiledAt = new Date().toISOString();
  const stageBreakdown: Record<CompileStage, CompileDiagnostic[]> = {
    'policy-scan': [],
    'manifest-validation': [],
    'type-check': [],
    'fixture-render': [],
    'layout-diag': [],
    'build': [],
    'artifact-write': [],
  };
  for (const diag of options.diagnostics) stageBreakdown[diag.stage].push(diag);

  // Synthesize the artifact-write diagnostic for the metadata file. We
  // do not mutate `options.diagnostics` (it is typed as readonly) — the
  // orchestrator adds the canonical record to its own list after this
  // function returns. The metadata on disk gets a frozen view of the
  // diagnostics plus this final stage entry.
  const writeDiag: CompileDiagnostic = {
    stage: 'artifact-write',
    level: 'pass',
    message: `artifact written to ${artifactDir}`,
    details: { artifactId, manifestHash, compiledAt },
  };
  stageBreakdown['artifact-write'].push(writeDiag);

  const allDiagnostics: readonly CompileDiagnostic[] =
    Object.freeze([...options.diagnostics, writeDiag]);

  const metadata = {
    artifactId,
    manifestHash,
    compiledAt,
    sourceRoot,
    outputRoot,
    pages: options.pages,
    hasOverflow: options.hasOverflow,
    manifest: options.manifest,
    diagnostics: allDiagnostics,
    stageBreakdown,
  };

  writeFileSync(
    join(artifactDir, 'compile-metadata.json'),
    canonicalJson(metadata),
    'utf8',
  );

  return { artifactId, manifestHash, artifactDir, compiledAt };
}


interface CollectedFile {
  readonly absPath: string;
  readonly relPath: string;
}

async function collectAndHash(root: string): Promise<{
  files: readonly CollectedFile[];
  hashBytes: Buffer;
}> {
  const files: CollectedFile[] = [];
  walk(root, root, files);

  const hasher = createHash('sha256');
  // Sort by relative path so the hash is deterministic across OS/filesystem
  // ordering. The bytes hashed are the canonical form of each file plus
  // its path, so two sources with the same files in different orders hash
  // the same.
  const sorted = [...files].sort((a, b) => (a.relPath < b.relPath ? -1 : a.relPath > b.relPath ? 1 : 0));
  for (const file of sorted) {
    hasher.update(file.relPath);
    hasher.update('\n');
    hasher.update(readFileSync(file.absPath));
    hasher.update('\n');
  }
  return { files, hashBytes: Buffer.from(hasher.digest('binary'), 'binary') };
}

function walk(root: string, dir: string, out: CollectedFile[]): void {
  let entries: readonly import('node:fs').Dirent[];
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (IGNORE_DIRS.has(entry.name)) continue;
      walk(root, join(dir, entry.name), out);
      continue;
    }
    if (!entry.isFile()) continue;
    if (IGNORE_FILE_SUFFIXES.some((suffix) => entry.name.endsWith(suffix))) continue;
    const abs = resolve(dir, entry.name);
    const rel = relative(root, abs);
    out.push({ absPath: abs, relPath: rel });
  }
}

async function safeMkdir(dir: string): Promise<void> {
  await new Promise<void>((resolveMkdir) => {
    mkdirSync(dir, { recursive: true });
    resolveMkdir();
  });
}

/**
 * Produce a deterministic JSON serialization. Used both for hashing inputs
 * and for the on-disk metadata file so revisions are byte-stable.
 */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalize(value), replacer);
}

function canonicalize(value: unknown): unknown {
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map(canonicalize);
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(value as Record<string, unknown>).sort()) {
    out[key] = canonicalize((value as Record<string, unknown>)[key]);
  }
  return out;
}

function replacer(_key: string, value: unknown): unknown {
  return value;
}

/** Sha256 of a buffer, hex-encoded. */
function sha256Hex(buf: Buffer): string {
  return createHash('sha256').update(buf).digest('hex');
}

/**
 * Compute the artifact id of a source root without writing anything. Useful
 * for tests and for workspace-level dedup checks before invoking the
 * full compile.
 */
export async function computeArtifactId(sourceRoot: string): Promise<string> {
  const { hashBytes } = await collectAndHash(resolve(sourceRoot));
  return sha256Hex(hashBytes);
}

// Touch extname so the import is part of the static graph (used by future
// extension-aware filtering if we ever add it).
void extname;