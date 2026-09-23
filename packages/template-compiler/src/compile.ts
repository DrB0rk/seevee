// Compile orchestration. `compileTemplate()` runs every stage in order:
// policy scan → manifest validation → astro/type check → fixture render →
// layout diag → artifact build → artifact write. Every stage contributes a
// `CompileDiagnostic`; any stage with level=fail causes the run to throw a
// `CompileError` whose `.stage` matches the diagnostic.
//
// The orchestrator never executes template source code. The fixture render
// step runs in this process but only walks parsed CV data — no `astro
// build`, no template imports. The astro check step (when run) happens in
// a child process with no host filesystem access above the source tree.

import { runPolicyScan } from './policy-scan.js';
import { validateManifest, readManifestFromDisk } from './manifest.js';
import { runAstroCheck } from './astro-check.js';
import { renderFixtures } from './fixture-render.js';
import { buildArtifact } from './artifact.js';

import {
  CompileError,
  ManifestError,
  PolicyError,
  RenderError,
} from './errors.js';

import type {
  CompileArtifact,
  CompileDiagnostic,
  CompileOptions,
  CompileStage,
} from './types.js';

const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_MEMORY_MB = 512;

export async function compileTemplate(
  options: CompileOptions,
): Promise<CompileArtifact> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const memoryMb = options.memoryMb ?? DEFAULT_MEMORY_MB;

  const diagnostics: CompileDiagnostic[] = [];

  runPolicyScanStage(options, diagnostics);
  runManifestStage(options, diagnostics);

  const checkOutcome = await runAstroCheck({
    sourceRoot: options.sourceRoot,
    timeoutMs,
    memoryMb,
  });
  diagnostics.push(checkOutcome.diagnostic);
  if (checkOutcome.diagnostic.level === 'fail') {
    throw new CompileError('type-check', 'astro check failed', {
      cause: checkOutcome.diagnostic,
    });
  }

  const renderOutcome = await renderFixtures({
    fixtureDir: options.fixtureDir,
  });
  diagnostics.push(renderOutcome.diagnostic);

  if (renderOutcome.hasOverflow) {
    const diag: CompileDiagnostic = {
      stage: 'layout-diag',
      level: 'fail',
      message: `layout diagnostics reported overflow on ${renderOutcome.perFixture.length} fixture(s)`,
      details: {
        totalOverflow: renderOutcome.diagnostics.totalOverflow,
        perFixture: renderOutcome.perFixture,
      },
    };
    diagnostics.push(diag);
    throw new RenderError('fixture render produced overflow', {
      cause: renderOutcome.diagnostics,
      source: options.fixtureDir,
    });
  }
  diagnostics.push({
    stage: 'layout-diag',
    level: 'pass',
    message: 'no overflow detected',
    details: {
      totalOverflow: renderOutcome.diagnostics.totalOverflow,
      hasClipping: renderOutcome.diagnostics.hasClipping,
    },
  });

  diagnostics.push({
    stage: 'build',
    level: 'pass',
    message: 'beginning artifact build',
  });

  const artifact = await buildArtifact({
    sourceRoot: options.sourceRoot,
    outputRoot: options.outputRoot,
    manifest: options.manifest,
    diagnostics,
    pages: renderOutcome.pages,
    hasOverflow: renderOutcome.hasOverflow,
  });

  diagnostics.push({
    stage: 'artifact-write',
    level: 'pass',
    message: `artifact written to ${artifact.artifactDir}`,
    details: {
      artifactId: artifact.artifactId,
      manifestHash: artifact.manifestHash,
      compiledAt: artifact.compiledAt,
    },
  });

  return {
    artifactId: artifact.artifactId,
    sourceRoot: options.sourceRoot,
    outputRoot: options.outputRoot,
    manifest: options.manifest,
    manifestHash: artifact.manifestHash,
    compiledAt: artifact.compiledAt,
    diagnostics,
    pages: renderOutcome.pages,
    hasOverflow: renderOutcome.hasOverflow,
  };
}

function runPolicyScanStage(
  options: CompileOptions,
  diagnostics: CompileDiagnostic[],
): void {
  try {
    const summary = runPolicyScan(options.sourceRoot);
    diagnostics.push({
      stage: 'policy-scan',
      level: 'pass',
      message: `policy scan accepted ${summary.files} file(s) with ${summary.imports} import(s)`,
      details: { files: summary.files, imports: summary.imports },
    });
  } catch (err) {
    const source = err instanceof PolicyError ? err.source : undefined;
    diagnostics.push({
      stage: 'policy-scan',
      level: 'fail',
      message: err instanceof Error ? err.message : String(err),
      ...(source === undefined ? {} : { details: { source } }),
    });
    throw new CompileError('policy-scan', 'policy scan rejected template', {
      cause: err,
    });
  }
}

function runManifestStage(
  options: CompileOptions,
  diagnostics: CompileDiagnostic[],
): void {
  try {
    validateManifest(options.manifest);
    diagnostics.push({
      stage: 'manifest-validation',
      level: 'pass',
      message: 'manifest validated',
      details: {
        templateId: options.manifest.templateId,
        version: options.manifest.version,
      },
    });
  } catch (err) {
    diagnostics.push({
      stage: 'manifest-validation',
      level: 'fail',
      message: err instanceof Error ? err.message : String(err),
    });
    throw new CompileError(
      'manifest-validation',
      'manifest validation failed',
      {
        cause: err,
        ...(err instanceof ManifestError && err.source !== undefined
          ? { source: err.source }
          : {}),
      },
    );
  }
}

/** Re-exported for callers that want to load a manifest from disk first. */
export { readManifestFromDisk };

/** Compile stages as a runtime list, useful for iteration in tooling. */
export const COMPILE_STAGES: readonly CompileStage[] = Object.freeze([
  'policy-scan',
  'manifest-validation',
  'type-check',
  'fixture-render',
  'layout-diag',
  'build',
  'artifact-write',
]);