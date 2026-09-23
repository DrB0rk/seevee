// Error hierarchy for the export pipeline. Every error a caller can
// observe carries a stable `name` so downstream `error.name === '...'`
// checks remain a useful contract: we never invent ad-hoc statuses that
// break the typed surface.
//
//   ExportError               – base for every error from this package.
//     ├── ValidationError     – canonical resources failed to validate.
//     ├── RenderDiagnosticsError
//     │                       – layout diagnostics reported fatal overflow
//     │                         and `allowForcedExport` was not granted.
//     ├── PlaywrightNotInstalledError
//     │                       – the `playwright` package is not installed
//     │                         on the running Node.
//     ├── TemplateArtifactError
//     │                       – the compiled template artifact at
//     │                         `templateArtifactPath` could not be loaded
//     │                         or validated.
//     ├── PdfRenderError      – Playwright threw during page.pdf().
//     ├── PdfValidationError  – generated PDF disagreed with the renderer
//     │                         on page count or physical dimensions.
//     └── IoError             – filesystem operations the pipeline relies
//                               on (mkdir, writeFile) failed.
//
// All errors extend `Error`. We avoid `cause` chaining on purpose: the
// message is the contract; callers should not need to traverse it.

/**
 * Base class for every error produced by `@seevee/export`.
 *
 * Caller-facing `error.name === 'ExportError'` remains a stable hook the
 * dashboard can use to classify unexpected failures without inspecting
 * the message.
 */
export class ExportError extends Error {
  public override readonly name: string = 'ExportError';
  constructor(message: string) {
    super(message);
  }
}

/**
 * Canonical resources (CV / workspace / presentation) failed structural
 * or semantic validation. The error carries the parsed `issues` array
 * so callers can surface specific codes.
 */
export class ValidationError extends ExportError {
  public override readonly name: string = 'ValidationError';
  public readonly issues: readonly ValidationIssue[];
  constructor(
    message: string,
    issues: readonly ValidationIssue[] = [],
  ) {
    super(message);
    this.issues = issues;
  }
}

export interface ValidationIssue {
  readonly code: string;
  readonly message: string;
  readonly path?: string;
}

/**
 * Layout diagnostics reported fatal overflow or clipping and the
 * caller did not set `allowForcedExport: true`. Carries the offending
 * `RenderDiagnostics` so the caller can render the issue list.
 */
export class RenderDiagnosticsError extends ExportError {
  public override readonly name: string = 'RenderDiagnosticsError';
  public readonly diagnostics: unknown;
  constructor(message: string, diagnostics: unknown) {
    super(message);
    this.diagnostics = diagnostics;
  }
}

/**
 * The `playwright` package is not installed on the running Node. The
 * action message is actionable; tests and the CLI surface this verbatim.
 */
export class PlaywrightNotInstalledError extends ExportError {
  public override readonly name: string = 'PlaywrightNotInstalledError';
  constructor(message: string) {
    super(message);
  }
}

/**
 * The compiled template artifact could not be loaded or its on-disk
 * payload did not match the expected compiled-artifact envelope.
 */
export class TemplateArtifactError extends ExportError {
  public override readonly name: string = 'TemplateArtifactError';
  constructor(message: string) {
    super(message);
  }
}

/**
 * Playwright threw during `page.pdf()`. We surface the original
 * message verbatim and never re-throw the upstream error class.
 */
export class PdfRenderError extends ExportError {
  public override readonly name: string = 'PdfRenderError';
  constructor(message: string) {
    super(message);
  }
}

/**
 * The generated PDF disagreed with the renderer's diagnostics on page
 * count or physical dimensions.
 */
export class PdfValidationError extends ExportError {
  public override readonly name: string = 'PdfValidationError';
  constructor(message: string) {
    super(message);
  }
}

/**
 * Wrapped filesystem failure. We do not expose the underlying `code`
 * because the export pipeline treats every such failure as a hard
 * abort; the message is enough for operators.
 */
export class IoError extends ExportError {
  public override readonly name: string = 'IoError';
  constructor(message: string) {
    super(message);
  }
}
