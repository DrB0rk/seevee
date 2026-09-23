// Layout diagnostics. The renderer (separate package) emits a `PageContent`
// for every page it lays out; this module evaluates that content against a
// `PageProfile` and produces pure `PageDiagnostic` records the dashboard can
// surface in its diagnostics panel.
//
// Everything here is pure data — no DOM, no filesystem APIs — so the module is safe
// for templates to import.

import type { ItemId, PageDiagnostic, RenderDiagnostics } from './types.js';
import type { PageProfile } from './types.js';

// ─── A4 / Letter / Legal page sizes in millimetres ──────────────────────────
//
// We only need to support the presets templates use today. Custom sizes are
// answered straight from the profile (see `contentBoxMm`).
const PRESET_SIZE_MM: Record<PageProfile['preset'], { width: number; height: number }> = {
  A4: { width: 210, height: 297 },
  Letter: { width: 215.9, height: 279.4 },
  Legal: { width: 215.9, height: 355.6 },
  custom: { width: 210, height: 297 }, // fall back to A4 when width/height are missing
};

/** Compute the inner content box (width × height, in mm) for a page profile. */
export function contentBoxMm(profile: PageProfile): { width: number; height: number } {
  const preset = PRESET_SIZE_MM[profile.preset];
  const width = profile.width ?? preset.width;
  const height = profile.height ?? preset.height;
  const scale = profile.scale ?? 1;
  const horizontalBleed = (profile.edges?.left ?? 0) + (profile.edges?.right ?? 0);
  const verticalBleed = (profile.edges?.top ?? 0) + (profile.edges?.bottom ?? 0);
  const innerWidth = Math.max(1, width * scale - horizontalBleed);
  const innerHeight = Math.max(1, height * scale - verticalBleed);
  return { width: innerWidth, height: innerHeight };
}

/**
 * Page content the renderer emits per page. We accept this shape directly so
 * templates can call `evaluatePageLayout` with the exact structure the
 * renderer produces — kept narrow so a renderer bug surfaces here.
 */
export interface PageContent {
  readonly pageNumber: number;
  readonly itemIds: readonly ItemId[];
  readonly contentHeightMm: number; // measured laid-out height in mm
  readonly itemOverflowMm?: Readonly<Record<string, number>>; // itemId → mm past content box
  readonly fontSubstitutions?: readonly string[];
  readonly missingAssets?: readonly string[];
}

interface EvaluateOptions {
  /** Override the inner content box (otherwise derived from the profile). */
  readonly contentBox?: { width: number; height: number };
}

/**
 * Evaluate a single page layout. Returns a PageDiagnostic that records
 * overflow, clipping, and blank-page state.
 *
 * `overflow` is true when the laid-out content exceeds the page's inner
 * content box along the vertical axis. The `overflowAmount` is the number
 * of millimetres the content went over the box, never negative.
 *
 * `blankPage` is true when the page has no items at all (or every item has
 * effectively zero rendered height — treated as zero).
 */
export function evaluatePageLayout(
  pageContent: PageContent,
  pageProfile: PageProfile,
  options: EvaluateOptions = {},
): PageDiagnostic {
  const box = options.contentBox ?? contentBoxMm(pageProfile);
  const overflowAmount = Math.max(0, pageContent.contentHeightMm - box.height);
  const overflow = overflowAmount > 0;

  const clippedNodes: ItemId[] = [];
  if (pageContent.itemOverflowMm !== undefined) {
    for (const [itemId, amount] of Object.entries(pageContent.itemOverflowMm)) {
      if (amount > 0) clippedNodes.push(itemId as ItemId);
    }
  }

  const blankPage = pageContent.itemIds.length === 0;

  return Object.freeze({
    pageNumber: pageContent.pageNumber,
    overflow,
    overflowAmount,
    clippedNodes: Object.freeze(clippedNodes) as readonly ItemId[],
    blankPage,
  });
}

/**
 * Collate per-page diagnostics into the render-wide diagnostic record. Pages
 * are summed for totalOverflow; clipping/blank flags collapse via OR; font
 * substitutions and missing assets are deduplicated with the order preserved
 * by first appearance.
 */
export function aggregateDiagnostics(
  pages: readonly PageDiagnostic[],
  fontSubstitutions: readonly string[] = [],
  missingAssets: readonly string[] = [],
): RenderDiagnostics {
  let totalOverflow = 0;
  let hasClipping = false;
  let hasBlankPages = false;

  for (const page of pages) {
    totalOverflow += page.overflowAmount;
    if (page.clippedNodes.length > 0) hasClipping = true;
    if (page.blankPage) hasBlankPages = true;
  }

  const fonts = Object.freeze(dedupe(fontSubstitutions));
  const assets = Object.freeze(dedupe(missingAssets));

  return Object.freeze({
    pages: Object.freeze([...pages]) as readonly PageDiagnostic[],
    totalOverflow,
    hasClipping,
    hasBlankPages,
    fontSubstitutions: fonts,
    missingAssets: assets,
  });
}

function dedupe(values: readonly string[]): string[] {
  const seen = new Set<string>();
  const ordered: string[] = [];
  for (const value of values) {
    if (seen.has(value)) continue;
    seen.add(value);
    ordered.push(value);
  }
  return ordered;
}

/**
 * Helper used by the `hasOverflow` predicate in the public surface. Returns
 * true if any page in the diagnostic record overflowed.
 */
export function hasOverflow(diagnostics: RenderDiagnostics): boolean {
  return diagnostics.totalOverflow > 0;
}
