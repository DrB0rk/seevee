// Turns a template's real Astro output into the complete HTML document that
// Playwright prints.
//
// This is the step that makes an export look like the user's chosen template
// rather than a generic paginator dump. `renderTemplateToHtml` returns an
// HTML *fragment* with two deliberate gaps:
//
//   1. no `<html>`/`<head>`/`<body>` envelope, so there is nowhere to put the
//      `@page` rules Chromium needs to size and paginate the sheet;
//   2. no `<style>` at all. Astro's container renders components in "partial"
//      mode, which suppresses head injection, so the template's scoped CSS is
//      dropped even though the markup carries the matching `data-astro-cid-*`
//      attributes. The CSS is still recoverable from the template's Vite
//      module graph via `collectTemplateStyles`.
//
// Both gaps are closed here, and only here: this is the single place that
// knows how to assemble a printable document from template output. Callers
// (CLI, studio) get a finished document string and never re-derive it.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import type { CvDocument, PageProfile, PresentationDocument } from '@seevee/schema';
import {
  resolveProfile,
  pageCss,
  type ProfilePreset,
  type ResolvedPageProfile,
} from '@seevee/renderer';
import { collectTemplateStyles, renderTemplateToHtml } from '@seevee/template-render';

import { ExportError, TemplateArtifactError } from './errors.js';

/** Stylesheet directories a template may ship beside its entry, in load order. */
const STYLESHEET_DIRS: readonly string[] = ['styles'];

/** Print-oriented baseline. Templates own all visual styling; this only
 *  establishes the page box and strips the screen-only default margin so the
 *  profile's own margins are authoritative. */
const PRINT_BASE_CSS = [
  'html, body { margin: 0; padding: 0; background: #fff; }',
  'body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }',
  '[data-seevee-page] { box-sizing: border-box; }',
].join('\n');

export interface TemplateDocumentOptions {
  /** Absolute path to the directory holding `src/` and `template.json`. */
  readonly templateRoot: string;
  /** Template-relative entry component; defaults to the manifest's `entry`. */
  readonly entry?: string;
  readonly cv: CvDocument;
  readonly presentation?: PresentationDocument;
  readonly pageProfile: PageProfile;
}

/**
 * Render a template to a complete, printable HTML document.
 *
 * @throws `TemplateArtifactError` — the template could not be rendered or its
 *   stylesheets could not be read.
 */
export async function renderTemplateDocument(
  options: TemplateDocumentOptions,
): Promise<string> {
  const { templateRoot, entry, cv, presentation, pageProfile } = options;

  let fragment: string;
  try {
    fragment = await renderTemplateToHtml({
      templateRoot,
      ...(entry === undefined ? {} : { entry }),
      cv,
      ...(presentation === undefined ? {} : { presentation }),
      profile: pageProfile,
    });
  } catch (error) {
    // Re-classify: callers of this package must not have to import
    // `@seevee/template-render` just to handle a broken template.
    throw new TemplateArtifactError(
      `failed to render template at '${templateRoot}': ${(error as Error).message}`,
    );
  }

  // Ordered after the render on purpose — the style modules only exist in the
  // template's Vite module graph once the entry has been evaluated.
  const sheets = await collectTemplateStyles({
    templateRoot,
    ...(entry === undefined ? {} : { entry }),
  });
  const extraStylesheets = await readTemplateStylesheets(templateRoot);

  return buildDocument({
    fragment,
    pageProfile,
    title: documentTitle(cv),
    stylesheets: [
      ...sheets.map((sheet) => sheet.content),
      ...extraStylesheets,
    ],
  });
}

/**
 * Read the template's own print stylesheet (`styles/print.css`).
 *
 * Astro's scoped `<style>` blocks cover a template's component styling but
 * cannot express page-level print concerns — `@page` size/margins,
 * `break-inside: avoid`, orphan control. Templates ship those in
 * `styles/print.css`, which is compiled as an *external* stylesheet and so is
 * not in the module graph above. Missing file is normal, not an error.
 */
async function readTemplateStylesheets(
  templateRoot: string,
): Promise<readonly string[]> {
  const contents: string[] = [];
  for (const dir of STYLESHEET_DIRS) {
    for (const name of ['print.css']) {
      try {
        const css = readFileSync(join(templateRoot, dir, name), 'utf8');
        if (css.trim().length > 0) contents.push(css);
      } catch {
        // Optional: a template without a print stylesheet still prints.
      }
    }
  }
  return contents;
}

/** Resolve the page profile onto the renderer's geometry model. */
function resolvePageGeometry(profile: PageProfile): ResolvedPageProfile {
  const preset: ProfilePreset =
    profile.preset === 'custom'
      ? 'Custom'
      : profile.preset === 'Legal'
        ? 'Letter' // Legal is not a renderer preset; geometry falls back to Letter.
        : profile.preset;

  // The renderer's profile model carries one scalar margin; use the
  // presentation's own left margin when present so an asymmetric profile is
  // not silently symmetrised away.
  const edges = profile.edges;
  const margin =
    edges === undefined
      ? undefined
      : Math.max(edges.top, edges.right, edges.bottom, edges.left);

  return resolveProfile({
    preset,
    ...(profile.preset === 'custom'
      ? {
          width: requireDimension(profile.width, 'width', profile),
          height: requireDimension(profile.height, 'height', profile),
        }
      : {}),
    ...(margin === undefined ? {} : { margins: margin }),
    orientation: profile.orientation,
  });
}

function requireDimension(
  value: number | undefined,
  field: string,
  profile: PageProfile,
): number {
  if (value === undefined) {
    throw new ExportError(
      `custom page profile requires '${field}' (got ${JSON.stringify(profile)})`,
    );
  }
  return value;
}

/**
 * Assemble the document. Page geometry comes from the profile so Chromium
 * sizes and paginates the sheet correctly; everything visual comes from the
 * template's own CSS, injected ahead of the baseline so a template can
 * override the page box if it wants to.
 */
function buildDocument(input: {
  readonly fragment: string;
  readonly pageProfile: PageProfile;
  readonly title: string;
  readonly stylesheets: readonly string[];
}): string {
  const geometry = resolvePageGeometry(input.pageProfile);
  const styles = [
    ...input.stylesheets,
    pageCss(geometry),
    PRINT_BASE_CSS,
  ]
    .filter((css) => css.trim().length > 0)
    .join('\n');

  return (
    '<!doctype html>\n' +
    '<html lang="en">\n' +
    '<head>\n' +
    '<meta charset="utf-8">\n' +
    `<title>${escapeHtml(input.title)}</title>\n` +
    `<style>\n${styles}\n</style>\n` +
    '</head>\n' +
    `<body>\n${input.fragment}\n</body>\n` +
    '</html>\n'
  );
}

const HTML_ESCAPES: Readonly<Record<string, string>> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (ch) => HTML_ESCAPES[ch] ?? ch);
}

/**
 * Best-effort document title from the CV's identity. `display` is the
 * schema-required name form, so this never has to guess a layout; if it is
 * blank we fall back to a neutral title rather than failing an export over it.
 */
function documentTitle(cv: CvDocument): string {
  const display = cv.data.identity.name.display.trim();
  return display.length > 0 ? display : 'CV';
}