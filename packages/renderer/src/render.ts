// Top-level render entry. The renderer takes a parsed CV document
// (validated by `@seevee/schema`), a presentation document carrying the
// active template/page-profile selections, and a page-profile, and
// produces:
//
//   1. an HTML document containing one `<article class="seevee-page">`
//      per physical page;
//   2. a `RenderDiagnostics` record with per-page overflow / blank-page
//      / clipped-node metadata.
//
// Overflow is never hidden to make validation pass. When content
// exceeds a page, the diagnostic record carries the overflow amount and
// the affected item IDs.

import type {
  CvDocument,
  PresentationDocument,
} from '@seevee/schema';
import {
  aggregateDiagnostics,
  evaluatePageLayout,
  hasOverflow,
  type ItemId,
  type PageDiagnostic,
  type RenderDiagnostics,
} from '@seevee/template-sdk';

import { renderDocument } from './html.js';
import { paginate, type PaginatedPage, type PaginationResult } from './pagination.js';
import {
  contentBoxMm,
  resolveProfile,
  toSdkPageProfile,
  type ProfilePreset,
  type ResolvedPageProfile,
} from './profile.js';
import { buildReadModel } from './read-model.js';

export interface RendererOptions {
  /**
   * The compiled template manifest. The renderer does not consult the
   * manifest for layout decisions in the MVP — it is reserved for
   * template-specific overrides that arrive in later iterations. Today
   * we accept it so the public surface stays stable.
   */
  readonly templateManifest?: unknown;
  /**
   * The compiled Astro component source. Same story: accepted today so
   * the API surface matches the contract, unused until the renderer
   * learns to evaluate a compiled template.
   */
  readonly templateSource?: string;
  /** Page-profile descriptor (preset name + optional dimensions). */
  readonly pageProfile: RendererPageProfileInput;
  /** Resolved font file paths keyed by font-family name. */
  readonly fonts?: ReadonlyMap<string, string>;
  /** Upper bound on rendered pages; defaults to 64. */
  readonly maxPages?: number;
  /** Optional presentation document for token/section overrides. */
  readonly presentation?: PresentationDocument;
}

export type RendererPageProfileInput =
  | ProfilePreset
  | {
      readonly preset: 'Custom';
      readonly width: number;
      readonly height: number;
      readonly margins?: number;
      readonly orientation?: 'portrait' | 'landscape';
    }
  | {
      readonly preset: 'A4' | 'Letter';
      readonly margins?: number;
      readonly orientation?: 'portrait' | 'landscape';
    };

export interface RenderResult {
  readonly html: string;
  readonly pages: readonly PageDiagnostic[];
  readonly diagnostics: RenderDiagnostics;
  readonly totalPages: number;
}

/**
 * Render a CV document into a deterministic, paginated HTML document.
 * The function is pure: the same inputs always produce the same
 * `html`, the same `pages`, and the same `diagnostics`.
 */
export function renderCvToPages(
  cv: CvDocument,
  options: RendererOptions,
): RenderResult {
  const resolved = resolveRendererProfile(options);
  const { cv: readModel, items } = buildReadModel(cv, {
    breakBehavior: breakBehaviorFromPresentation(options.presentation),
  });
  const result = paginate(items, {
    pageHeightMm: contentBoxMm(resolved).height,
    maxPages: options.maxPages,
  });
  const html = renderDocument(result.pages, resolved, {
    title: readModel.document.data.identity.name.display,
  });
  const diagnostics = diagnose(result, resolved);
  return {
    html,
    pages: diagnostics.pages,
    diagnostics,
    totalPages: diagnostics.pages.length,
  };
}

function resolveRendererProfile(options: RendererOptions): ResolvedPageProfile {
  const input = options.pageProfile;
  if (typeof input === 'string') {
    return resolveProfile({ preset: input });
  }
  if (input.preset === 'Custom') {
    return resolveProfile({
      preset: 'Custom',
      width: input.width,
      height: input.height,
      margins: input.margins,
      orientation: input.orientation,
    });
  }
  return resolveProfile({
    preset: input.preset,
    margins: input.margins,
    orientation: input.orientation,
  });
}

function breakBehaviorFromPresentation(
  presentation: PresentationDocument | undefined,
): 'avoid' | 'split' | 'page-before' | 'page-after' | 'auto' | undefined {
  if (presentation === undefined) return undefined;
  return presentation.data.pagination.breakBehavior;
}

/**
 * Render a presentation document by chaining the presentation's
 * referenced CV through `renderCvToPages`. The presentation supplies
 * the page profile and pagination policy; the CV supplies the data.
 */
export function renderPresentationToHtml(
  presentation: PresentationDocument,
  cv: CvDocument,
  options: Omit<RendererOptions, 'pageProfile' | 'presentation'>,
): RenderResult {
  const profile = presentationPageProfile(presentation);
  return renderCvToPages(cv, {
    ...options,
    pageProfile: profile,
    presentation,
  });
}

function presentationPageProfile(
  presentation: PresentationDocument,
): RendererPageProfileInput {
  const page = presentation.data.page;
  if (page.preset === 'custom') {
    if (page.width === undefined || page.height === undefined) {
      throw new Error(
        'renderer: presentation page profile marked custom but missing width/height',
      );
    }
    return {
      preset: 'Custom',
      width: page.width,
      height: page.height,
      orientation: page.orientation,
    };
  }
  if (page.preset === 'A4' || page.preset === 'Letter') {
    return {
      preset: page.preset,
      orientation: page.orientation,
    };
  }
  // The schema currently allows A4/Letter/Legal/custom. Legal is not a
  // renderer preset today; fall back to Letter so callers still get a
  // page rather than a thrown error during render.
  return { preset: 'Letter', orientation: page.orientation };
}

function diagnose(
  result: PaginationResult,
  resolved: ResolvedPageProfile,
): RenderDiagnostics {
  const sdkProfile = toSdkPageProfile(resolved);
  const pageDiagnostics: PageDiagnostic[] = result.pages.map((page) =>
    evaluatePageLayout(toPageContent(page, result), sdkProfile),
  );
  return aggregateDiagnostics(pageDiagnostics, [], []);
}

/**
 * The SDK's `evaluatePageLayout` accepts a `PageContent` value whose
 * shape is private to the diagnostics module. The renderer constructs
 * exactly that shape (page number, item ids, content height, optional
 * per-item overflow map) so the call site is fully typed even without
 * re-exporting the private type.
 */
interface SdkPageContent {
  readonly pageNumber: number;
  readonly itemIds: readonly ItemId[];
  readonly contentHeightMm: number;
  readonly itemOverflowMm?: Readonly<Record<string, number>>;
}

function toPageContent(
  page: PaginatedPage,
  result: PaginationResult,
): SdkPageContent {
  const itemIds = page.items.map((item) => item.id);
  const itemOverflowMm: Record<string, number> = {};
  for (const item of page.items) {
    const overflow = result.overflowByItem[item.id];
    if (overflow !== undefined && overflow > 0) {
      itemOverflowMm[item.id] = overflow;
    }
  }
  return {
    pageNumber: page.pageNumber,
    itemIds,
    contentHeightMm: page.contentHeightMm,
    ...(Object.keys(itemOverflowMm).length > 0 ? { itemOverflowMm } : {}),
  };
}

// Re-export the diagnostics predicate so callers can test overflow
// without rebuilding the aggregate themselves.
export { hasOverflow };
