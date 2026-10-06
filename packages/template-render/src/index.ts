// `@seevee/template-render` — executes real Astro source templates to HTML.
//
// This is the package that makes template-driven rendering real: it compiles a
// template's own `.astro` entry through Astro's Vite plugin and renders it
// with Astro's server-rendering container, so what the studio shows is the
// template's actual output rather than a stub or a hand-built HTML string.

export { renderTemplateToHtml } from './render.js';
export type { RenderTemplateOptions } from './render.js';

export { readTemplateManifest } from './manifest.js';

export {
  cachedTemplateCount,
  collectTemplateStyles,
  invalidateTemplate,
  loadTemplateEntry,
  resolveEntryPath,
} from './server.js';
export type {
  CollectTemplateStylesOptions,
  TemplateServer,
  TemplateStylesheet,
} from './server.js';

export {
  EntryNotFoundError,
  isTemplateRenderError,
  ManifestInvalidError,
  ManifestNotFoundError,
  TemplateCompileError,
  TemplateRenderError,
  TemplateRootNotFoundError,
  TemplateRuntimeError,
} from './errors.js';
export type { TemplateRenderErrorCode } from './errors.js';