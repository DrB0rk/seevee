// `renderTemplateToHtml` — the public entry point of this package.
//
// Executes a real template's entry `.astro` file and returns the rendered
// HTML. Everything expensive (Astro runtime modules, the per-template Vite
// server) is cached by server.ts; this module owns argument validation,
// manifest fallback, and error classification.

import type { CvDocument, PresentationDocument, PageProfile } from '@seevee/schema';

import { readTemplateManifest } from './manifest.js';
import { loadTemplateEntry, resolveEntryPath, toTemplateError } from './server.js';

/** Default entry path when the caller does not name one. */
const DEFAULT_ENTRY = 'src/Resume.astro';

export interface RenderTemplateOptions {
  /** Absolute path to the directory holding `src/` and `template.json`. */
  readonly templateRoot: string;
  /** Template-relative entry component, e.g. `'src/Resume.astro'`. */
  readonly entry?: string;
  /** The CV to render. */
  readonly cv: CvDocument;
  /** Optional presentation document driving template tokens. */
  readonly presentation?: PresentationDocument;
  /** Page geometry exposed to the template as `profile`. */
  readonly profile: PageProfile;
}

/**
 * Render a template entry to an HTML fragment.
 *
 * The result is the rendered template body — Astro's container renders a
 * component, not a document, so there is no `<html>`/`<head>` envelope here.
 * Callers that need a full document wrap this with
 * `packages/renderer`'s `renderDocument`.
 */
export async function renderTemplateToHtml(
  options: RenderTemplateOptions,
): Promise<string> {
  const { templateRoot, entry, cv, presentation, profile } = options;

  // Validate the root before anything else: a caller pointing at a
  // nonexistent directory should get "root not found", not a confusing
  // "no template.json here" from the manifest reader below.
  resolveEntryPath(templateRoot, entry ?? DEFAULT_ENTRY);

  // The manifest is read before the Vite boot so a template with a broken
  // manifest fails fast, and so its declared entry drives the render when
  // the caller did not name one.
  const manifest = readTemplateManifest(templateRoot);
  const resolvedEntry = entry ?? manifest.entry ?? DEFAULT_ENTRY;

  const { component, server } = await loadTemplateEntry(templateRoot, resolvedEntry);

  try {
    return await server.container.renderToString(component, {
      props: {
        cv,
        presentation,
        profile,
        template: manifest,
      },
    });
  } catch (error) {
    throw toTemplateError(error, resolvedEntry);
  }
}