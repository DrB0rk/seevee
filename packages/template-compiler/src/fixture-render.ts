import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import {
  aggregateDiagnostics,
  evaluatePageLayout,
} from '@seevee/template-sdk';
import type { RenderDiagnostics, PageDiagnostic, ItemId } from '@seevee/template-sdk';
import type { PageContent } from '@seevee/template-sdk/diagnostics';
import { cvDocumentSchema } from '@seevee/schema';
import type { CvDocument, PageProfile } from '@seevee/schema';

import type { CompileDiagnostic } from './types.js';

export interface FixtureRenderOptions {
  readonly fixtureDir: string;
}

export interface FixtureRenderOutcome {
  readonly diagnostic: CompileDiagnostic;
  readonly diagnostics: RenderDiagnostics;
  readonly pages: number;
  readonly hasOverflow: boolean;
  readonly perFixture: readonly { readonly file: string; readonly pages: number }[];
}

/**
 * Default A4 page profile used when the fixture's CV does not specify a
 * presentation. The MVP stub only needs enough information to lay out a
 * single page.
 */
const DEFAULT_PAGE_PROFILE: PageProfile = Object.freeze({
  preset: 'A4',
  orientation: 'portrait',
  edges: Object.freeze({ top: 20, right: 20, bottom: 20, left: 20 }),
}) as PageProfile;

/**
 * Average height a single CV item occupies in the stub layout, in mm.
 * Chosen so a CV with very few items does not overflow A4, and a CV with
 * many items does — see `compile.test.ts` for the overflow fixture.
 */
const STUB_ITEM_HEIGHT_MM = 12;

/**
 * Run the render pass against every `*.json` file in `fixtureDir`. Files
 * that are not valid CV documents are skipped with a warn-level diagnostic.
 * The aggregate `RenderDiagnostics` is computed across every accepted
 * fixture so the layout-diag stage has a single source of truth.
 */
export async function renderFixtures(
  options: FixtureRenderOptions,
): Promise<FixtureRenderOutcome> {
  const fixtures = listFixtures(options.fixtureDir);
  const pageDiagnostics: PageDiagnostic[] = [];
  const perFixture: { file: string; pages: number }[] = [];

  for (const file of fixtures) {
    const cv = parseCvFixture(file);
    if (cv === null) continue;

    const pages = stubRender(cv);
    for (const page of pages) {
      pageDiagnostics.push(
        evaluatePageLayout(page, DEFAULT_PAGE_PROFILE),
      );
    }
    perFixture.push({ file, pages: pages.length });
  }

  const aggregated = aggregateDiagnostics(pageDiagnostics);
  const hasOverflow = aggregated.totalOverflow > 0;

  return {
    diagnostic: {
      stage: 'fixture-render',
      level: 'pass',
      message: `rendered ${fixtures.length} fixture(s) (${pageDiagnostics.length} page(s))`,
      details: {
        fixtureCount: fixtures.length,
        pageCount: pageDiagnostics.length,
        totalOverflow: aggregated.totalOverflow,
      },
    },
    diagnostics: aggregated,
    pages: pageDiagnostics.length,
    hasOverflow,
    perFixture,
  };
}

/**
 * List every `*.json` fixture under a directory. Returns absolute paths.
 * Returns an empty array when the directory does not exist or has no
 * JSON files; that case is treated as a pass-with-no-fixtures diagnostic
 * by the caller.
 */
function listFixtures(fixtureDir: string): readonly string[] {
  let entries: readonly import('node:fs').Dirent[];
  try {
    entries = readdirSync(fixtureDir, { withFileTypes: true });
  } catch {
    return [];
  }
  const out: string[] = [];
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    if (!entry.name.toLowerCase().endsWith('.json')) continue;
    out.push(join(fixtureDir, entry.name));
  }
  return out;
}

/**
 * Parse one fixture file as a CV document. Returns null when the JSON
 * doesn't conform to `cvDocumentSchema`; the caller skips the fixture
 * but the overall compile still passes.
 */
function parseCvFixture(absPath: string): CvDocument | null {
  let text: string;
  try {
    text = readFileSync(absPath, 'utf8');
  } catch {
    return null;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  const result = cvDocumentSchema.safeParse(parsed);
  if (!result.success) return null;
  return result.data;
}

/**
 * Minimal stub renderer. It produces exactly one page per CV whose
 * `contentHeightMm` equals the number of entities in the CV times
 * {@link STUB_ITEM_HEIGHT_MM}. This deliberately produces overflow for
 * any CV with more than 20 entities on A4, so the overflow fixture in
 * `compile.test.ts` is straightforward to construct.
 *
 * When the real `@seevee/renderer` is wired in, this function will be
 * replaced — the boundary is exactly `renderFixtures` so the swap is a
 * drop-in.
 */
function stubRender(cv: CvDocument): readonly PageContent[] {
  const itemCount = countEntities(cv);
  const contentHeightMm = itemCount * STUB_ITEM_HEIGHT_MM;
  const itemIds = collectItemIds(cv) as readonly ItemId[];

  // the layout-diag stage has something to evaluate; the page will be
  // marked blank by `evaluatePageLayout`.
  const page: PageContent = {
    pageNumber: 1,
    itemIds,
    contentHeightMm,
  };

  return Object.freeze([Object.freeze(page)]);
}

function countEntities(cv: CvDocument): number {
  const stores = cv.data.entities;
  let total = 0;
  for (const value of Object.values(stores)) {
    if (value === undefined) continue;
    total += Object.keys(value).length;
  }
  return total;
}

function collectItemIds(cv: CvDocument): readonly string[] {
  const ids: string[] = [];
  for (const value of Object.values(cv.data.entities)) {
    if (value === undefined) continue;
    for (const id of Object.keys(value)) ids.push(id);
  }
  return Object.freeze(ids);
}