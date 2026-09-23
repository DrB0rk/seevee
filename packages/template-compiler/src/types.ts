// Public compile types. These are the shape of `compileTemplate()`'s input
// and output, plus the diagnostic record every stage emits.

import type { TemplateManifestDocument } from '@seevee/schema';

/** Diagnostic stage identifiers — used both as labels and as a discriminator. */
export type CompileStage =
  | 'policy-scan'
  | 'manifest-validation'
  | 'type-check'
  | 'fixture-render'
  | 'layout-diag'
  | 'build'
  | 'artifact-write';

/** Severity levels for a single diagnostic entry. */
export type CompileLevel = 'pass' | 'warn' | 'fail' | 'skipped';

/** A single diagnostic emitted by one compile stage. */
export interface CompileDiagnostic {
  readonly stage: CompileStage;
  readonly level: CompileLevel;
  readonly message: string;
  readonly details?: Record<string, unknown>;
}

/**
 * The manifest the compiler operates on. We re-export the schema type as the
 * authoritative one rather than maintaining a parallel hand-rolled interface.
 */
export type TemplateManifest = TemplateManifestDocument;

/** Options accepted by {@link compileTemplate}. */
export interface CompileOptions {
  /** Absolute path to the template source root (`templates/<id>/<version>/`). */
  readonly sourceRoot: string;
  /** The parsed template manifest. */
  readonly manifest: TemplateManifest;
  /** Absolute path to a directory containing representative fixture CVs. */
  readonly fixtureDir: string;
  /** Absolute path to the directory the artifact should be written under. */
  readonly outputRoot: string;
  /** Override the default 30-second per-stage timeout. */
  readonly timeoutMs?: number;
  /** Override the default 512 MiB child-process memory limit. */
  readonly memoryMb?: number;
}

/**
 * The result returned by a successful compile. Contains every input needed
 * to register the artifact in a workspace and an audit trail of every stage.
 */
export interface CompileArtifact {
  /** Content-addressable id: sha256 of the source tree's canonical bytes. */
  readonly artifactId: string;
  readonly sourceRoot: string;
  readonly outputRoot: string;
  readonly manifest: TemplateManifest;
  /** sha256 of the canonical manifest JSON. */
  readonly manifestHash: string;
  /** ISO-8601 timestamp at which the artifact was finalized. */
  readonly compiledAt: string;
  readonly diagnostics: readonly CompileDiagnostic[];
  /** Sum of page counts across every fixture rendered. */
  readonly pages: number;
  /** True when any fixture produced an overflowed page. */
  readonly hasOverflow: boolean;
}