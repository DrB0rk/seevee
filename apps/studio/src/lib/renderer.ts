/**
 * CV → physical pages renderer for the Studio preview canvas.
 *
 * This executes the workspace's *real* template: `@seevee/template-render`
 * boots Astro's compiler against the version's own `.astro` entry and returns
 * the rendered HTML, so what the canvas paints is the template's output rather
 * than a hand-built approximation of it.
 *
 * Two things make the result usable as a page surface, and both are part of
 * this module's contract:
 *
 *   1. `renderTemplateToHtml` returns a *fragment* — Astro's container renders a
 *      component, not a document — so there is no `<html>` envelope and no
 *      page geometry. `buildPreviewDocument` adds both.
 *   2. The same container renders with `partial: true`, which drops the
 *      template's scoped `<style>` blocks even though the elements still carry
 *      their `data-astro-cid-*` classes. A fragment without those rules is
 *      unstyled content, so the CSS is collected back out of the template's
 *      module graph and inlined.
 *
 * Diagnostics come from the renderer's own paginator, which measures the same
 * CV against the same page box. They describe the content's fit; they are not
 * browser-measured layout, and are reported as such.
 */
import {
  pageCss,
  resolveProfile,
  renderCvToPages as renderContentPages,
  type PageDiagnostic,
  type ResolvedPageProfile,
} from '@seevee/renderer';
import { collectTemplateStyles, invalidateTemplate, renderTemplateToHtml } from '@seevee/template-render';
import type {
  CvDocument,
  PageProfile,
  PresentationDocument,
} from '@seevee/schema';

import { resolvePageGeometry, type ResolvedPageGeometry } from './workspace.js';

/** Absolute path of the template version being rendered. */
export interface TemplateRef {
  readonly root: string;
  /** Template-relative entry, taken from the version's manifest. */
  readonly entry: string;
}

export interface PageBlock {
  blockId: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Page {
  pageNumber: number;
  width: number;
  height: number;
  overflow: boolean;
  overflowAmount: number;
  blocks: PageBlock[];
  /**
   * This page's slice of the rendered template fragment. The fragment is a
   * single continuous document, so page 1 carries it whole and any later page
   * is empty — real pagination happens in the browser against laid-out
   * height, not here. Kept per-page so a client can render a page surface
   * without special-casing the first one.
   */
  html: string;
}

export interface PageResult {
  pages: Page[];
  /** The rendered template fragment, wrapped in a full HTML document. */
  html: string;
  diagnostics: {
    overflow: boolean;
    clippedNodes: string[];
    blankPages: number[];
    warnings: string[];
  };
}

export interface RenderInput {
  cv: CvDocument;
  presentation: PresentationDocument;
  /** Resolved absolute template version directory. */
  template: TemplateRef;
  /** Override the page preset taken from the presentation document. */
  profile?: 'A4' | 'Letter' | 'custom';
  /** Override the page geometry taken from the presentation document. */
  geometry?: ResolvedPageGeometry;
}

/**
 * Render the active template against a CV and return the page surfaces.
 *
 * `profile` is applied as a *preset override only*: a `custom` override has no
 * width/height of its own in the request body, so it resolves through the
 * presentation's explicit dimensions. Anything genuinely missing falls back to
 * the presentation rather than to a guessed default, so the preview never
 * silently disagrees with the document it is previewing.
 */
export async function renderCvToPages(input: RenderInput): Promise<PageResult> {
  const { cv, presentation, template, profile } = input;
  const geometry = input.geometry ?? resolvePageGeometry(presentation.data);
  const effectiveGeometry: ResolvedPageGeometry =
    profile === undefined
      ? geometry
      : {
          ...geometry,
          preset: profile,
          widthMm: presetWidthMm(profile, geometry),
          heightMm: presetHeightMm(profile, geometry),
        };

  const pageProfile: PageProfile = {
    preset: effectiveGeometry.preset,
    orientation: effectiveGeometry.orientation,
    width: effectiveGeometry.widthMm,
    height: effectiveGeometry.heightMm,
    edges: presentation.data.page.edges,
  };

  // Ordering matters: the template's scoped stylesheets only enter the Vite
  // module graph once the entry has been SSR-loaded, so collecting styles
  // before the render resolves silently yields an empty list. Render first,
  // then collect.
  const rendered = await renderWithRecovery(template, { cv, presentation, profile: pageProfile });
  const fragment = rendered.fragment;
  const styles = rendered.styles;

  const resolved = toRendererProfile(effectiveGeometry);
  const html = buildPreviewDocument({
    fragment,
    styles,
    profile: resolved,
    title: cv.data.identity.name.display,
  });

  const measured = renderContentPages(cv, {
    pageProfile: rendererProfileInput(effectiveGeometry),
    presentation,
  });

  const documentDiagnostics = measured.diagnostics;
  const pageDiagnostics = documentDiagnostics.pages;
  // `totalOverflow` is millimetres past the content box; the response field is
  // a boolean predicate, so derive it rather than passing the amount through.
  const overflowMm = documentDiagnostics.totalOverflow;
  const warnings: string[] = [];
  if (overflowMm > 0) {
    warnings.push(
      `content overflows the page box by ${roundMm(overflowMm)}mm across the CV`,
    );
  }
  if (documentDiagnostics.hasBlankPages) {
    warnings.push('the paginator reports at least one blank page');
  }

  const pages: Page[] = pageDiagnostics.map((diagnostic: PageDiagnostic, index: number) => ({
    pageNumber: diagnostic.pageNumber,
    width: effectiveGeometry.widthMm,
    height: effectiveGeometry.heightMm,
    overflow: diagnostic.overflow,
    overflowAmount: diagnostic.overflowAmount,
    blocks: [],
    html: index === 0 ? fragment : '',
  }));

  return {
    pages: pages.length > 0 ? pages : [syntheticPage(effectiveGeometry)],
    html,
    diagnostics: {
      overflow: overflowMm > 0,
      clippedNodes: pageDiagnostics.flatMap((page: PageDiagnostic) => [...page.clippedNodes]),
      blankPages: pageDiagnostics.filter((page: PageDiagnostic) => page.blankPage).map((page: PageDiagnostic) => page.pageNumber),
      warnings,
    },
  };
}

/**
 * Render a template and collect its styles, recovering from a dead server.
 *
 * `@seevee/template-render` caches one Vite server per template root for the
 * process lifetime. If something in the host process tears down the transport
 * that server runs on — an agent worker exiting, a test runner recycling a
 * pool — the cached entry stays in the map but can no longer serve a module, and
 * every later render fails with "transport was disconnected". That is a
 * recoverable cache problem, not a broken template, so drop the stale server
 * and let a fresh one boot before reporting the failure.
 */
async function renderWithRecovery(
  template: TemplateRef,
  options: {
    readonly cv: CvDocument;
    readonly presentation: PresentationDocument;
    readonly profile: PageProfile;
  },
): Promise<{
  readonly fragment: string;
  readonly styles: ReadonlyArray<{ readonly id: string; readonly content: string }>;
}> {
  const render = async (): Promise<{
    fragment: string;
    styles: ReadonlyArray<{ readonly id: string; readonly content: string }>;
  }> => {
    // Sequential by design: styles only exist once the entry has been rendered.
    const fragment = await renderTemplateToHtml({
      templateRoot: template.root,
      entry: template.entry,
      cv: options.cv,
      presentation: options.presentation,
      profile: options.profile,
    });
    const styles = await collectTemplateStyles({
      templateRoot: template.root,
      entry: template.entry,
    });
    return { fragment, styles };
  };

  try {
    return await render();
  } catch (error) {
    if (!isDeadTemplateServer(error)) throw error;
    await invalidateTemplate(template.root);
    return render();
  }
}

/**
 * True when a throwable is a dead cached Vite server rather than a template bug.
 *
 * A broken template must still surface its compile/runtime error; only the
 * transport-level failures justify dropping the cache and retrying.
 */
function isDeadTemplateServer(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  return (
    error.message.includes('transport was disconnected') ||
    error.message.includes('WebSocket is not open') ||
    error.message.includes('fetchModule')
  );
}

/**
 * Wrap the template fragment in a full HTML document with page geometry.
 *
 * The geometry comes from `@seevee/renderer` so the preview's `@page` rule and
 * page box are computed by the same code that drives PDF export — two
 * hand-written copies of the margin math would drift.
 */
function buildPreviewDocument(options: {
  readonly fragment: string;
  readonly styles: ReadonlyArray<{ readonly id: string; readonly content: string }>;
  readonly profile: ResolvedPageProfile;
  readonly title: string;
}): string {
  const { fragment, styles, profile, title } = options;
  // One `<style>` per stylesheet rather than a concatenation: the ids come from
  // Astro's `?astro&type=style&index=N` modules, and keeping them separate
  // preserves the ability to dedupe by id if two components ever emit the same
  // sheet. Scoped selectors stay valid because the fragment keeps the matching
  // `data-astro-cid-*` attributes.
  //
  // An empty list is legitimate — a template with no CSS of its own renders
  // unstyled but correct, so it must not be treated as a fault.
  const styleBlocks = styles
    .map((sheet) => `<style data-seevee-template-style="${escapeHtml(sheet.id)}">\n${sheet.content}\n</style>`)
    .join('\n');
  return [
    '<!doctype html>',
    '<html lang="en">',
    '<head>',
    '<meta charset="utf-8">',
    `<title>${escapeHtml(title)}</title>`,
    `<style>\n${pageCss(profile)}\n</style>`,
    styleBlocks,
    '</head>',
    '<body>',
    fragment,
    '</body>',
    '</html>',
  ].join('\n');
}

export interface InspectInput {
  presentation: PresentationDocument;
  /** Already-loaded CVs, keyed by cv id, used to measure each presentation. */
  readonly cvs?: ReadonlyMap<string, CvDocument>;
}

export interface InspectResult {
  pageCount: number;
  pageGeometry: ResolvedPageGeometry;
  diagnostics: PageResult['diagnostics'];
}

/**
 * Layout diagnostics for a presentation, measured without rendering a template.
 *
 * Measuring is a pure function of the CV and the page box, so inspect does not
 * need to boot a template — it only needs the CV the presentation targets.
 */
export function inspectPresentation(input: InspectInput): InspectResult {
  const geometry = resolvePageGeometry(input.presentation.data);
  const cv = input.cvs?.get(input.presentation.data.cvId);
  if (cv === undefined) {
    return {
      pageCount: 0,
      pageGeometry: geometry,
      diagnostics: {
        overflow: false,
        clippedNodes: [],
        blankPages: [],
        warnings: ['no CV loaded for this presentation — layout was not measured'],
      },
    };
  }
  const measured = renderContentPages(cv, {
    pageProfile: rendererProfileInput(geometry),
    presentation: input.presentation,
  });
  const diagnostics = measured.diagnostics;
  const warnings: string[] = [];
  if (diagnostics.totalOverflow > 0) {
    warnings.push(
      `content overflows the page box by ${roundMm(diagnostics.totalOverflow)}mm across the CV`,
    );
  }
  return {
    pageCount: diagnostics.pages.length,
    pageGeometry: geometry,
    diagnostics: {
      overflow: diagnostics.totalOverflow > 0,
      clippedNodes: diagnostics.pages.flatMap((page: PageDiagnostic) => [...page.clippedNodes]),
      blankPages: diagnostics.pages.filter((page: PageDiagnostic) => page.blankPage).map((page: PageDiagnostic) => page.pageNumber),
      warnings,
    },
  };
}

/**
 * Drop the cached Vite server for one template root so the next render
 * re-reads the template's source from disk.
 *
 * The studio owns change detection (`WorkspaceWatcher`), so the invalidation is
 * deliberately explicit and per-root: a template edit must not tear down an
 * unrelated template's server.
 */
export async function invalidateTemplateVersion(templateRoot: string): Promise<void> {
  await invalidateTemplate(templateRoot);
}

function rendererProfileInput(
  geometry: ResolvedPageGeometry,
): Parameters<typeof renderContentPages>[1]['pageProfile'] {
  if (geometry.preset === 'custom') {
    return { preset: 'Custom', width: geometry.widthMm, height: geometry.heightMm };
  }
  if (geometry.preset === 'A4') return { preset: 'A4' };
  if (geometry.preset === 'Letter') return { preset: 'Letter' };
  // `Legal` has no renderer preset; the renderer resolves `Custom` by
  // dimensions, so pass the measured box through rather than approximating it.
  return { preset: 'Custom', width: geometry.widthMm, height: geometry.heightMm };
}

function toRendererProfile(geometry: ResolvedPageGeometry): ResolvedPageProfile {
  const margin = 0;
  if (geometry.preset === 'A4') return resolveProfile({ preset: 'A4', margins: margin });
  if (geometry.preset === 'Letter') return resolveProfile({ preset: 'Letter', margins: margin });
  return resolveProfile({
    preset: 'Custom',
    width: geometry.widthMm,
    height: geometry.heightMm,
    margins: margin,
    orientation: geometry.orientation,
  });
}

function syntheticPage(geometry: ResolvedPageGeometry): Page {
  return {
    pageNumber: 1,
    width: geometry.widthMm,
    height: geometry.heightMm,
    overflow: false,
    overflowAmount: 0,
    blocks: [],
    html: '',
  };
}

const PRESET_DIMENSIONS_MM: Readonly<Record<string, { width: number; height: number }>> = {
  A4: { width: 210, height: 297 },
  Letter: { width: 215.9, height: 279.4 },
  Legal: { width: 215.9, height: 355.6 },
  custom: { width: 210, height: 297 },
};

function presetWidthMm(preset: string, geometry: ResolvedPageGeometry): number {
  if (preset === 'custom') return geometry.widthMm;
  return PRESET_DIMENSIONS_MM[preset]?.width ?? geometry.widthMm;
}

function presetHeightMm(preset: string, geometry: ResolvedPageGeometry): number {
  if (preset === 'custom') return geometry.heightMm;
  return PRESET_DIMENSIONS_MM[preset]?.height ?? geometry.heightMm;
}

function roundMm(value: number): number {
  return Number.parseFloat(value.toFixed(2));
}

function escapeHtml(value: string): string {
  return value.replace(
    /[&<>"']/g,
    (ch) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch] ?? ch,
  );
}