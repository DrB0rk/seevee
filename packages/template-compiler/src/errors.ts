// Compile errors. We export a single root class (`CompileError`) and one
// subclass per stage so callers can branch on the failure point without
// parsing message strings. Every error carries the stage identifier so the
// caller can correlate with the corresponding `CompileDiagnostic`.

import type { CompileStage } from './types.js';

/**
 * Base class for every compile-time failure. The `stage` property lets the
 * caller correlate the exception with the `CompileDiagnostic` record the
 * compile run emitted for the same stage.
 */
export class CompileError extends Error {
  readonly stage: CompileStage;
  readonly source?: string;

  constructor(
    stage: CompileStage,
    message: string,
    options?: { readonly cause?: unknown; readonly source?: string },
  ) {
    super(message, options?.cause === undefined ? undefined : { cause: options.cause });
    this.name = 'CompileError';
    this.stage = stage;
    if (options?.source !== undefined) {
      this.source = options.source;
    }
  }
}

/** Thrown when the static policy scan rejects the template source. */
export class PolicyError extends CompileError {
  constructor(
    message: string,
    options?: { readonly cause?: unknown; readonly source?: string },
  ) {
    super('policy-scan', message, options);
    this.name = 'PolicyError';
  }
}

/** Thrown when `template.json` fails schema validation. */
export class ManifestError extends CompileError {
  constructor(
    message: string,
    options?: { readonly cause?: unknown; readonly source?: string },
  ) {
    super('manifest-validation', message, options);
    this.name = 'ManifestError';
  }
}

/** Thrown when fixture rendering produces an overflow or another failure. */
export class RenderError extends CompileError {
  constructor(
    message: string,
    options?: { readonly cause?: unknown; readonly source?: string },
  ) {
    super('fixture-render', message, options);
    this.name = 'RenderError';
  }
}