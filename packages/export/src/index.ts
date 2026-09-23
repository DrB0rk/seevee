// Public entry point for `@seevee/export`.
//
// The public surface is intentionally small:
//
//   - `exportToPdf` — the orchestrator.
//   - `ExportError` (and the named subclasses).
//   - `isPlaywrightAvailable` / `isPlaywrightInstalledAt` — gating.
//   - `ExportOptions`, `ExportResult`, `ExportMetadataRecord` — types.
//
// Anything else from the package (`capturePdf`, internal helpers) is
// intentionally NOT re-exported; we keep the contract minimal so the
// dashboard can rely on the published shape.

export { exportToPdf } from './export.js';
export {
  isPlaywrightAvailable,
  isPlaywrightInstalledAt,
  loadPlaywrightModule,
  capturePdf,
} from './playwright.js';
export {
  ExportError,
  ValidationError,
  RenderDiagnosticsError,
  PlaywrightNotInstalledError,
  PdfRenderError,
  PdfValidationError,
  TemplateArtifactError,
  IoError,
  type ValidationIssue,
} from './errors.js';
export {
  loadValidatedResources,
  type ValidatedResources,
} from './validate.js';
export {
  loadCompiledArtifact,
  type LoadedTemplateArtifact,
  type LoadArtifactOptions,
} from './template-load.js';
export {
  writeExportMetadata,
  exportMetadataPath,
  generateExportId,
  type WriteMetadataOptions,
  type MetadataFs,
} from './metadata.js';
export {
  readPdfInfo,
  type PdfInfo,
} from './pdf-info.js';

export type {
  ExportOptions,
  ExportResult,
  ExportMetadataRecord,
  PlaywrightModule,
  PlaywrightBrowser,
  PlaywrightPage,
  PlaywrightPdfOptions,
} from './types.js';
