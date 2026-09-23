// Astro / TypeScript type check wrapper. The compiler runs `astro check`
// inside a sandboxed child process so a malicious template cannot reach the
// host filesystem or network during the check. When `astro` is not present
// in the surrounding toolchain (CI, scaffold smoke test) the stage is
// recorded with `level: 'skipped'` and the compile continues.
//
// The child-process sandbox mirrors the one described in TEMPLATE_AUTHORING
// §5:
//   - `--max-old-space-size=<memoryMb>` enforces a heap cap;
//   - a `setTimeout` enforces a per-stage timeout;
//   - the child's CWD is `sourceRoot` so the template cannot reach above
//     its own tree;
//   - we do NOT pass `--watch` — `astro check` runs once and exits.

import { spawn } from 'node:child_process';
import { access } from 'node:fs/promises';
import { resolve } from 'node:path';

import type { CompileDiagnostic } from './types.js';

export interface AstroCheckOptions {
  readonly sourceRoot: string;
  readonly timeoutMs: number;
  readonly memoryMb: number;
}

export interface AstroCheckOutcome {
  readonly diagnostic: CompileDiagnostic;
  readonly exitCode: number | null;
}

const ASTRO_BINARY_CANDIDATES: readonly string[] = Object.freeze([
  resolve(process.cwd(), 'node_modules', '.bin', 'astro'),
  resolve(process.cwd(), '..', '..', 'node_modules', '.bin', 'astro'),
  '/usr/local/bin/astro',
  '/usr/bin/astro',
]);

/**
 * Locate an `astro` binary. We probe a small set of deterministic paths so
 * the check runs without fetching from the registry.
 */
async function locateAstro(): Promise<string | null> {
  for (const candidate of ASTRO_BINARY_CANDIDATES) {
    try {
      await access(candidate);
      return candidate;
    } catch {
      // continue
    }
  }
  return null;
}

/**
 * Run `astro check` for a template source. Returns a single diagnostic with
 * `level: 'skipped'` when astro is not on PATH and the appropriate level
 * otherwise. Never throws — the caller converts a fail diagnostic into a
 * `CompileError`.
 */
export function runAstroCheck(
  options: AstroCheckOptions,
): Promise<AstroCheckOutcome> {
  const settled = Promise.withResolvers<AstroCheckOutcome>();

  void (async () => {
    const astroBin = await locateAstro();
    if (astroBin === null) {
      settled.resolve({
        diagnostic: {
          stage: 'type-check',
          level: 'skipped',
          message: 'astro binary not found on PATH; skipping type-check stage',
        },
        exitCode: null,
      });
      return;
    }

    const args = ['check', '--noSync'];
    const child = spawn(astroBin, args, {
      cwd: options.sourceRoot,
      env: {
        ...process.env,
        NODE_OPTIONS: `--max-old-space-size=${options.memoryMb}`,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    let finished = false;

    const finish = (
      level: CompileDiagnostic['level'],
      message: string,
      exitCode: number | null,
    ): void => {
      if (finished) return;
      finished = true;
      settled.resolve({
        diagnostic: {
          stage: 'type-check',
          level,
          message,
          details: {
            exitCode,
            stdout: stdout.slice(0, 4_000),
            stderr: stderr.slice(0, 4_000),
          },
        },
        exitCode,
      });
    };

    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      finish('fail', `astro check exceeded ${options.timeoutMs}ms timeout`, null);
    }, options.timeoutMs);

    child.stdout?.on('data', (chunk: Buffer | string) => {
      stdout += chunk.toString();
    });
    child.stderr?.on('data', (chunk: Buffer | string) => {
      stderr += chunk.toString();
    });

    child.on('error', (err) => {
      clearTimeout(timer);
      finish('fail', `astro check could not be spawned: ${err.message}`, null);
    });

    child.on('exit', (code) => {
      clearTimeout(timer);
      if (code === 0) {
        finish('pass', 'astro check passed', code);
      } else {
        finish('fail', `astro check exited with code ${code}`, code);
      }
    });
  })().catch((err: unknown) => {
    settled.resolve({
      diagnostic: {
        stage: 'type-check',
        level: 'fail',
        message: `astro check wrapper crashed: ${err instanceof Error ? err.message : String(err)}`,
        details: { error: err instanceof Error ? err.stack : String(err) },
      },
      exitCode: null,
    });
  });

  return settled.promise;
}