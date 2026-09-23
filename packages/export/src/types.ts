// Public types for the export pipeline.
//
// `ExportOptions` and `ExportResult` are the only types the user of
// `@seevee/export` ever needs to reach for. Everything else is internal.

import type { PageProfile } from '@seevee/schema';
import type { RenderDiagnostics } from '@seevee/template-sdk';

/**
 * Inputs for `exportToPdf`. Each field is deliberately required unless
 * it has a sensible default; we never accept `null`/`undefined` in
 * place of documented options to avoid silent misconfiguration.
 */
export interface ExportOptions {
  /**
   * Absolute path to the Seevee workspace root. Used both to resolve
   * canonical resources (CV / workspace / presentation) and to write
   * the persistent export metadata at
   * `<workspaceRoot>/.seevee/exports/<exportId>.json`.
   */
  readonly workspaceRoot: string;

  /**
   * ID of the CV being exported. Resolved against
   * `workspace.data.resources.cvs` to find the relative on-disk path,
   * which is then read and parsed with the CV Zod schema.
   */
  readonly cvId: string;

  /**
   * Optional presentation ID. Defaults to
   * `workspace.data.active.presentationId` when omitted.
   */
  readonly presentationId?: string;

  /**
   * Absolute path to the compiled template artifact directory (or its
   * manifest). The pipeline loads the manifest via `template-load`,
   * runs the standard safety/runtime checks, and hands the resolved
   * payload to the renderer as `RendererOptions.templateManifest`.
   */
  readonly templateArtifactPath: string;

  /**
   * Absolute path the generated PDF will be written to. The directory
   * must exist — the pipeline does not auto-create it.
   */
  readonly outputPath: string;

  /**
   * The active page profile. Schema-shaped (preset + orientation +
   * optional width/height/edges) so the renderer can resolve margins
   * without us papering over the contract.
   */
  readonly pageProfile: PageProfile;

  /**
   * When true, the pipeline will still attempt to render even when
   * the diagnostics report fatal overflow or clipping. Default `false`
   * — exports refuse to produce a known-broken artifact unless the
   * caller explicitly asks for it.
   */
  readonly allowForcedExport?: boolean;

  /**
   * Optional observer that receives the final `RenderDiagnostics`
   * after the renderer has completed but before the export is
   * considered successful. The observer MUST be synchronous from the
   * caller's point of view; throwing inside it propagates as a hard
   * export failure.
   */
  readonly onDiagnostics?: (diagnostics: RenderDiagnostics) => void;

  /**
   * Override the Playwright module used by the pipeline. Tests use
   * this to inject a fake that does not require Playwright to be
   * actually installed. Defaults to the dynamically-resolved
   * `playwright` package; the resolver falls back to a
   * `PlaywrightNotInstalledError` when the package is missing.
   */
  readonly playwright?: PlaywrightModule;
}

/**
 * Successful export result. Carries the persistent metadata plus the
 * transient in-memory summary: the pipeline always writes the
 * metadata JSON next to the workspace regardless of whether the caller
 * keeps a reference.
 */
export interface ExportResult {
  readonly outputPath: string;
  readonly pageCount: number;
  readonly pageProfile: PageProfile;
  readonly bytes: number;
  readonly sha256: string;
  readonly exportId: string;
  readonly startedAt: string;
  readonly completedAt: string;
  readonly diagnostics: RenderDiagnostics;
}

/**
 * Structural subset of the `playwright` package the pipeline consumes.
 * Documenting the shape (rather than re-importing the types) keeps
 * `playwright` optional: the real module never has to be installed
 * at type-check time.
 */
export interface PlaywrightModule {
  readonly chromium: {
    launch(options?: {
      readonly headless?: boolean;
      readonly args?: readonly string[];
    }): Promise<PlaywrightBrowser>;
  };
}

export interface PlaywrightBrowser {
  newPage(): Promise<PlaywrightPage>;
  close(): Promise<void>;
}

export interface PlaywrightPage {
  setContent(
    html: string,
    options?: { readonly waitUntil?: 'load' | 'domcontentloaded' | 'networkidle' },
  ): Promise<void>;
  pdf(options: PlaywrightPdfOptions): Promise<Uint8Array>;
  close(): Promise<void>;
}

export interface PlaywrightPdfOptions {
  readonly path: string;
  readonly printBackground?: boolean;
  readonly format?: 'A4' | 'Letter' | 'Legal' | 'A3' | 'A5';
  readonly width?: string;
  readonly height?: string;
  readonly margin?: {
    readonly top?: string;
    readonly right?: string;
    readonly bottom?: string;
    readonly left?: string;
  };
  readonly preferCSSPageSize?: boolean;
}

/**
 * Persistent metadata written next to the workspace. The on-disk shape
 * is identical to `ExportResult`; the split exists only so future
 * revisions can extend the on-disk record without polluting the
 * in-memory contract.
 */
export interface ExportMetadataRecord extends ExportResult {}
