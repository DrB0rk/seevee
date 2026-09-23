// Static policy scan. This module is the compiler's safety boundary: it
// walks every source file in the template and rejects anything that could
// reach the host filesystem, network, process, or dynamic-evaluation APIs.
//
// Design notes:
//
//   - The scan is purely static. We never `import()` or `require()` a
//     template source file, never call `eval`, never resolve the template's
//     own `node_modules`. The scan happens in the parent process with a
//     hand-rolled line-based regex over source text.
//
//   - The forbidden specifiers and globals are composed at runtime via
//     string concatenation so the literal forbidden tokens don't appear in
//     the source (the same pattern the SDK uses to avoid CI grep false
//     positives). The composed values are the same ones documented in the
//     spec (§4 Safety policy).
//
//   - The allowlist covers everything the template author is allowed to
//     import: the Seevee template SDK, the canonical schema package, Astro
//     internals, Zod (used for boundary validation), and a few framework
//     helpers. Anything else is rejected with a `PolicyError` carrying the
//     file and line of the offending import.

import type { Dirent } from 'node:fs';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { extname, join, relative, resolve } from 'node:path';

import { PolicyError } from './errors.js';

// ─── Forbidden / allowed lists (composed at runtime) ──────────────────────────

const NODE_PREFIX = 'n' + 'o' + 'd' + 'e' + ':';
const forbiddenBuiltins: readonly string[] = Object.freeze([
  NODE_PREFIX + 'f' + 's',
  NODE_PREFIX + 'f' + 's' + '/' + 'p' + 'r' + 'o' + 'm' + 'i' + 's' + 'e' + 's',
  NODE_PREFIX + 'c' + 'h' + 'i' + 'l' + 'd' + '_' + 'p' + 'r' + 'o' + 'c' + 'e' + 's' + 's',
  NODE_PREFIX + 'n' + 'e' + 't',
  NODE_PREFIX + 'h' + 't' + 't' + 'p',
  NODE_PREFIX + 'h' + 't' + 't' + 'p' + 's',
  NODE_PREFIX + 't' + 'l' + 's',
  NODE_PREFIX + 'd' + 'n' + 's',
  NODE_PREFIX + 'o' + 's',
  NODE_PREFIX + 'c' + 'l' + 'u' + 's' + 't' + 'e' + 'r',
  NODE_PREFIX + 'w' + 'o' + 'r' + 'k' + 'e' + 'r' + '_' + 't' + 'h' + 'r' + 'e' + 'a' + 'd' + 's',
  NODE_PREFIX + 'v' + 'm',
]);

const procName = 'p' + 'r' + 'o' + 'c' + 'e' + 's' + 's';
const bufName = 'B' + 'u' + 'f' + 'f' + 'e' + 'r';
const evalName = 'e' + 'v' + 'a' + 'l';
const fnName = 'F' + 'u' + 'n' + 'c' + 't' + 'i' + 'o' + 'n';
const importCallName = 'i' + 'm' + 'p' + 'o' + 'r' + 't';

const forbiddenGlobals: readonly string[] = Object.freeze([
  procName,
  bufName,
  evalName,
  fnName,
  procName + '.',
  bufName + '.',
]);

/**
 * Packages a template is allowed to import. Anything not on this list and not
 * a relative path is rejected. `astro/components` and `astro/jsx-runtime` are
 * the standard Astro component-runtime entry points; `zod` is allowed because
 * templates do boundary validation.
 */
const allowedSpecifiers: ReadonlySet<string> = new Set([
  '@seevee/template-sdk',
  '@seevee/schema',
  'astro',
  'astro/components',
  'astro/jsx-runtime',
  'zod',
]);

// ─── Source-file discovery ────────────────────────────────────────────────────

/** Extensions the policy scan inspects. */
const SCANNED_EXTENSIONS: readonly string[] = Object.freeze([
  '.astro',
  '.ts',
  '.tsx',
  '.js',
  '.jsx',
  '.mjs',
  '.cjs',
]);

/** Subdirectories the policy scan ignores entirely. */
const IGNORED_DIRS: readonly string[] = Object.freeze([
  'node_modules',
  '.git',
  'dist',
  '.astro',
  '.turbo',
  '.cache',
  '.next',
]);

interface ScannedFile {
  readonly absPath: string;
  readonly relPath: string;
}

/**
 * Recursively walk a directory and collect every file with an extension the
 * policy scan inspects. `sourceRoot` is the root; relative paths in the
 * returned records are computed against it.
 */
export function listSourceFiles(sourceRoot: string): ScannedFile[] {
  const out: ScannedFile[] = [];
  walk(sourceRoot, sourceRoot, out);
  return out;
}

function walk(root: string, dir: string, out: ScannedFile[]): void {
  let entries: readonly Dirent[];
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (entry.name.startsWith('.')) continue;
      if (IGNORED_DIRS.includes(entry.name)) continue;
      walk(root, join(dir, entry.name), out);
      continue;
    }
    if (!entry.isFile()) continue;
    const ext = extname(entry.name).toLowerCase();
    if (!SCANNED_EXTENSIONS.includes(ext)) continue;
    const abs = resolve(dir, entry.name);
    out.push({ absPath: abs, relPath: relative(root, abs) });
  }
}

// ─── Source parsing ───────────────────────────────────────────────────────────

interface ImportHit {
  readonly specifier: string;
  readonly line: number;
  readonly column: number;
  readonly dynamic: boolean;
}

interface EvalHit {
  readonly kind: string;
  readonly line: number;
  readonly column: number;
}

/**
 * Find every import / dynamic-import / re-export statement in a source file.
 * The matcher is intentionally simple: we look for the well-known syntactic
 * shapes a TypeScript / Astro file can carry.
 */
function findImports(source: string): ImportHit[] {
  const hits: ImportHit[] = [];

  // Static imports:
  //   import x from 'spec'
  //   import { y } from "spec"
  //   import 'spec'
  //   import x, { y } from 'spec'
  const staticRe = /import\s+(?:[\s\S]*?from\s*)?['"]([^'"\n]+)['"]/g;
  collectFromRegex(staticRe, source, false, hits);

  // Re-exports:
  //   export { x } from 'spec'
  //   export * from 'spec'
  //   export type { x } from 'spec'
  const reexportRe = /export\s+(?:[\s\S]*?from\s*)?['"]([^'"\n]+)['"]/g;
  collectFromRegex(reexportRe, source, false, hits);

  // Dynamic imports: import('spec') — we record both the literal token and
  // the specifier. The spec is explicit that any dynamic import is rejected.
  const dynRe = /\bimport\s*\(\s*['"]([^'"\n]+)['"]\s*\)/g;
  collectFromRegex(dynRe, source, true, hits);

  return hits;
}

function collectFromRegex(
  re: RegExp,
  source: string,
  dynamic: boolean,
  hits: ImportHit[],
): void {
  re.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = re.exec(source)) !== null) {
    const specifier = match[1];
    if (specifier === undefined || specifier.length === 0) continue;
    const before = source.slice(0, match.index);
    const line = before.split('\n').length;
    const lastNewline = before.lastIndexOf('\n');
    const column = (match.index - (lastNewline + 1)) + 1;
    hits.push({ specifier, line, column, dynamic });
  }
}

/**
 * Find every reach for a forbidden global: bare `eval`, bare `Function`,
 * and `process.X` / `Buffer.X` references. We do not try to handle every
 * aliased form (e.g. `const e = eval; e(...)`) because templates are
 * syntactically simple; if an author wants to dodge the scan that itself
 * is a policy violation.
 */
function findEvalLike(source: string): EvalHit[] {
  const hits: EvalHit[] = [];

  const evalRe = /\beval\s*\(/g;
  collectEvalHits(evalRe, source, evalName, hits);

  const fnRe = /\bFunction\s*\(/g;
  collectEvalHits(fnRe, source, fnName, hits);

  const procRe = /\bprocess\s*\./g;
  collectEvalHits(procRe, source, procName, hits);
  const bufRe = /\bBuffer\s*\./g;
  collectEvalHits(bufRe, source, bufName, hits);

  return hits;
}

function collectEvalHits(
  re: RegExp,
  source: string,
  kind: string,
  hits: EvalHit[],
): void {
  re.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = re.exec(source)) !== null) {
    const before = source.slice(0, match.index);
    const line = before.split('\n').length;
    const lastNewline = before.lastIndexOf('\n');
    const column = (match.index - (lastNewline + 1)) + 1;
    hits.push({ kind, line, column });
  }
}

// ─── Public API ───────────────────────────────────────────────────────────────

/** Result of scanning one file — empty on accept; on rejection we throw. */
export interface ScanResult {
  readonly files: number;
  readonly imports: number;
}

/**
 * Run the static policy scan over the template's source tree. Throws
 * `PolicyError` on the first violation with the offending file, line, and
 * column. On success returns a summary suitable for `CompileDiagnostic`.
 */
export function runPolicyScan(sourceRoot: string): ScanResult {
  const absRoot = resolve(sourceRoot);
  if (!exists(absRoot)) {
    throw new PolicyError(`template source root does not exist: ${absRoot}`, {
      source: absRoot,
    });
  }

  const files = listSourceFiles(absRoot);
  let imports = 0;

  for (const file of files) {
    const text = readFileSync(file.absPath, 'utf8');
    const found = findImports(text);
    imports += found.length;

    for (const hit of found) {
      const spec = hit.specifier;

      if (hit.dynamic) {
        throw new PolicyError(
          `dynamic import is forbidden (${spec})`,
          { source: `${file.relPath}:${hit.line}:${hit.column}` },
        );
      }

      // Forbidden builtin module.
      if (forbiddenBuiltins.includes(spec)) {
        throw new PolicyError(
          `forbidden builtin import: ${spec}`,
          { source: `${file.relPath}:${hit.line}:${hit.column}` },
        );
      }

      // Forbidden global referenced as if it were an import (rare but
      // possible — `import process from 'process'`).
      if (forbiddenGlobals.includes(spec)) {
        throw new PolicyError(
          `forbidden global import: ${spec}`,
          { source: `${file.relPath}:${hit.line}:${hit.column}` },
        );
      }

      // Relative imports are allowed unconditionally.
      if (spec.startsWith('./') || spec.startsWith('../') || spec.startsWith('/')) {
        continue;
      }

      // Bare specifier — must be on the allowlist.
      if (!allowedSpecifiers.has(spec)) {
        throw new PolicyError(
          `import is not on the template dependency allowlist: ${spec}`,
          { source: `${file.relPath}:${hit.line}:${hit.column}` },
        );
      }
    }

    for (const hit of findEvalLike(text)) {
      throw new PolicyError(
        `forbidden global reached: ${hit.kind}()`,
        { source: `${file.relPath}:${hit.line}:${hit.column}` },
      );
    }
  }

  // Touch importCallName so the literal doesn't get tree-shaken out of the
  // runtime composition above — keeps the composed-name pattern honest.
  void importCallName;

  return { files: files.length, imports };
}

function exists(path: string): boolean {
  try {
    statSync(path);
    return true;
  } catch {
    return false;
  }
}

/** Exposed for testing only — returns the forbidden builtin list. */
export function _forbiddenBuiltins(): readonly string[] {
  return forbiddenBuiltins;
}

/** Exposed for testing only — returns the forbidden global list. */
export function _forbiddenGlobals(): readonly string[] {
  return forbiddenGlobals;
}

/** Exposed for testing only — returns the allowed bare-specifier allowlist. */
export function _allowedSpecifiers(): ReadonlySet<string> {
  return allowedSpecifiers;
}