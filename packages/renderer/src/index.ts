// Public entry point for `@seevee/renderer`. The renderer turns a
// validated CV document plus a page profile into a deterministic,
// paginated HTML document with per-page layout diagnostics.
//
// The renderer is intentionally pure: no filesystem, network, or
// process APIs leak through this surface. The only side effect is the
// HTML string returned to the caller.

export {
  renderCvToPages,
  renderPresentationToHtml,
  hasOverflow,
  type RendererOptions,
  type RendererPageProfileInput,
  type RenderResult,
} from './render.js';

export {
  resolveProfile,
  toSdkPageProfile,
  contentBoxMm,
  pageCss,
  type ProfilePreset,
  type ResolvedPageProfile,
} from './profile.js';

export {
  buildReadModel,
  aggregateDiagnostics,
  type PaginatorItem,
  type BreakBehavior,
  type BuildReadModelOptions,
} from './read-model.js';

export { paginate, type PaginationResult, type PaginatedPage } from './pagination.js';

export { estimateItemHeightMm, measureOverflow } from './measurement.js';


// Re-export the SDK diagnostic types so callers don't need a second
// import path to read the result.
export type {
  PageDiagnostic,
  RenderDiagnostics,
} from '@seevee/template-sdk';
