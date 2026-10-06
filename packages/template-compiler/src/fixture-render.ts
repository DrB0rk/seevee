// The fixture-render stage: every `*.json` fixture in `fixtureDir` is fed to
// the template's REAL `.astro` entry, and the height the browser gives back
// is what the layout-diag stage evaluates. There are no per-entity constants
// here and no arithmetic that invents a page height.
//
// How a fixture becomes a measurement:
//
//   1. `renderTemplateToHtml` executes the template's own source and returns
//      the rendered fragment (a component render, so no `<html>` envelope).
//   2. `collectTemplateStyles` returns the compiled scoped CSS the fragment
//      needs. It must run AFTER the render — Astro populates the style
//      modules during the first SSR evaluation of the entry — so the order
//      of these two calls is load-bearing, not incidental.
//   3. `measureLayout` lays the styled fragment out in Chromium and returns
//      per-box geometry in millimetres, from which page count and per-item
//      overflow are computed.
//
// WHY THIS RUNS IN-PROCESS AND NOT IN THE CHILD-PROCESS SANDBOX:
// `astro check` runs in a child process because `astro check` is a *tool* —
// a CLI that needs its own process. Executing a template is not: it is an
// in-process Astro/Vite pipeline already designed for it
// (`@seevee/template-render`, used by the dashboard and the PDF export on
// the same host), and it boots in ~0.6s cold and ~1ms cached. Moving it into
// a sandbox would add a process boundary, a module-graph round trip, and a
// memory cap without adding containment: the policy-scan stage already
// rejected the template's imports before this stage runs, and
// `renderTemplateToHtml` resolves every host specifier through
// `@seevee/template-render`'s allowlist. The compile-time `timeoutMs` is
// applied to the whole stage below so a runaway template still cannot hang
// the compile.

import { readFileSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';

import {
  aggregateDiagnostics,
  contentBoxMm,
  evaluatePageLayout,
} from '@seevee/template-sdk';
import type { RenderDiagnostics, PageDiagnostic, ItemId } from '@seevee/template-sdk';
import type { PageContent } from '@seevee/template-sdk/diagnostics';
import {
  collectTemplateStyles,
  isTemplateRenderError,
  renderTemplateToHtml,
} from '@seevee/template-render';
import { cvDocumentSchema } from '@seevee/schema';
import type { CvDocument, PageProfile, TemplateManifestDocument } from '@seevee/schema';

import { measureLayout } from './layout-measure.js';
import type { LayoutMeasurement, MeasuringBrowser, MeasuringPlaywright } from './layout-measure.js';

import type { CompileDiagnostic } from './types.js';

export interface FixtureRenderOptions {
  readonly fixtureDir: string;
  /** Absolute template source root — the directory holding `src/` + `template.json`. */
  readonly sourceRoot: string;
  /** The manifest being compiled; supplies the entry and `multiPage` capability. */
  readonly manifest: TemplateManifestDocument;
  /** Budget for the whole stage. A template that overruns fails the stage. */
  readonly timeoutMs?: number;
  /**
   * Browser used to measure laid-out height. Injected by tests; resolved from
   * the host tree when omitted.
   */
  readonly playwright?: MeasuringPlaywright;
  /** Profile the fixtures are measured against. Defaults to A4 portrait, 20mm edges. */
  readonly pageProfile?: PageProfile;
}

/**
 * Per-fixture record. `pages` and `height` are the measured truth; the
 * boolean flags record which layout facts the measurement established.
 */
export interface FixtureMeasurement {
  readonly file: string;
  readonly pages: number;
  /** Laid-out content height in mm, measured in a browser. */
  readonly contentHeightMm: number;
  /** Content box the fixture was measured against, in mm. */
  readonly contentBoxHeightMm: number;
  readonly overflowMm: number;
}

export interface FixtureRenderOutcome {
  readonly diagnostic: CompileDiagnostic;
  readonly diagnostics: RenderDiagnostics;
  readonly pages: number;
  readonly hasOverflow: boolean;
  readonly perFixture: readonly FixtureMeasurement[];
}

/**
 * How the stage produced its numbers. Surfaced in the diagnostic so a reader
 * of `compile-metadata.json` can tell a measured run from one that could not
 * measure, without having to trust the stage name.
 */
export type FixtureRenderMode = 'measured' | 'skipped';

/**
 * Default A4 page profile used when no presentation supplies one.
 */
const DEFAULT_PAGE_PROFILE: PageProfile = Object.freeze({
  preset: 'A4',
  orientation: 'portrait',
  edges: Object.freeze({ top: 20, right: 20, bottom: 20, left: 20 }),
}) as PageProfile;

/** Sentinel page content height used when nothing could be measured. */
const UNMEASURED_HEIGHT_MM = 0;

/**
 * Run the render pass against every `*.json` file in `fixtureDir`. Files
 * that are not valid CV documents are skipped; a fixture that the template
 * cannot render fails the stage with the template's own typed error, because
 * a template that crashes on a fixture is exactly what this stage exists to
 * catch.
 */
export async function renderFixtures(
  options: FixtureRenderOptions,
): Promise<FixtureRenderOutcome> {
  const profile = options.pageProfile ?? DEFAULT_PAGE_PROFILE;
  const box = contentBoxMm(profile);
  const deadline = Date.now() + (options.timeoutMs ?? 30_000);

  const fixtures = listFixtures(options.fixtureDir);
  const pageDiagnostics: PageDiagnostic[] = [];
  const perFixture: FixtureMeasurement[] = [];
  const renderFailures: string[] = [];

  // The browser is launched once and reused across every fixture: a launch
  // costs ~140ms against a ~20ms measurement, so per-fixture launches would
  // dominate the stage.
  const session = await openMeasurementBrowser(options.playwright);
  if (session === null) {
    return unmeasuredOutcome(options, fixtures, 'no browser is available to measure layout');
  }

  try {
    for (const file of fixtures) {
      const cv = parseCvFixture(file);
      if (cv === null) continue;

      const rendered = await renderFixture(options, cv, profile, deadline, session.browser);

      if (rendered.failure !== undefined) {
        renderFailures.push(`${file}: ${rendered.failure}`);
        continue;
      }

      // One page per filled physical page. A template that declares
      // `multiPage: false` is held to one page: the content past the box is
      // overflow to report, not a second page to hide behind.
      const pageCount =
        options.manifest.capabilities.multiPage === false
          ? 1
          : Math.max(1, Math.ceil(rendered.measurement.contentHeightMm / box.height));
      const pageContents = buildPageContents(rendered, pageCount, box.height);

      for (const pageContent of pageContents) {
        pageDiagnostics.push(evaluatePageLayout(pageContent, profile));
      }

      perFixture.push(
        Object.freeze({
          file,
          pages: pageContents.length,
          contentHeightMm: rendered.measurement.contentHeightMm,
          contentBoxHeightMm: box.height,
          overflowMm: Math.max(0, rendered.measurement.contentHeightMm - box.height),
        }),
      );
    }
  } finally {
    await session.close();
  }

  const aggregated = aggregateDiagnostics(pageDiagnostics);
  const hasOverflow = aggregated.totalOverflow > 0;

  if (renderFailures.length > 0) {
    // A template that throws on a fixture is a compile failure, not a
    // warning: `compile.ts` turns a `fail` diagnostic into a thrown error.
    return {
      diagnostic: {
        stage: 'fixture-render',
        level: 'fail',
        message: `template failed to render ${renderFailures.length} fixture(s)`,
        details: { failures: renderFailures },
      },
      diagnostics: aggregated,
      pages: pageDiagnostics.length,
      hasOverflow,
      perFixture,
    };
  }

  return {
    diagnostic: {
      stage: 'fixture-render',
      level: 'pass',
      message: `rendered ${fixtures.length} fixture(s) in the real template (${pageDiagnostics.length} page(s))`,
      details: {
        mode: 'measured',
        fixtureCount: fixtures.length,
        pageCount: pageDiagnostics.length,
        totalOverflow: aggregated.totalOverflow,
        contentBoxHeightMm: box.height,
        perFixture,
      },
    },
    diagnostics: aggregated,
    pages: pageDiagnostics.length,
    hasOverflow,
    perFixture,
  };
}

/**
 * A rendered fixture: the measured geometry plus the item ids that geometry
 * can be attributed to.
 */
interface RenderedFixture {
  readonly measurement: LayoutMeasurement;
  readonly itemIds: readonly ItemId[];
  /** Set when the template could not render this fixture. */
  readonly failure?: string;
}

/**
 * Render one fixture through the real template and measure the result.
 *
 * Ordering here is load-bearing: `renderTemplateToHtml` must run BEFORE
 * `collectTemplateStyles`, because Astro only populates the compiled style
 * modules in the Vite module graph during the entry's first SSR evaluation.
 * Collecting first returns `[]` — silently, with no error — and the result is
 * an unstyled document whose measured heights are meaningless.
 */
async function renderFixture(
  options: FixtureRenderOptions,
  cv: CvDocument,
  profile: PageProfile,
  deadline: number,
  browser: MeasuringBrowser,
): Promise<RenderedFixture> {
  const remaining = deadline - Date.now();
  if (remaining <= 0) {
    return {
      measurement: emptyMeasurement(),
      itemIds: [],
      failure: 'compile timed out before this fixture rendered',
    };
  }

  try {
    // A runaway template must not hang the compile: the stage's own budget is
    // enforced here, and the timer is cleared on every exit path.
    let timer: NodeJS.Timeout | undefined;
    const timedOut = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(
        () => reject(new Error(`template render exceeded the ${remaining}ms budget left for this stage`)),
        remaining,
      );
      timer.unref?.();
    });

    try {
      return await Promise.race([renderAndMeasure(options, cv, profile, browser), timedOut]);
    } finally {
      // `clearTimeout` no-ops on an already-fired timer, so no guard.
      clearTimeout(timer);
    }
  } catch (error) {
    // A typed template error names its own failure mode (compile vs runtime
    // vs entry-not-found); keep the class name so `compile-metadata.json`
    // records which one it was.
    const message = isTemplateRenderError(error)
      ? `${error.name}: ${error.message}`
      : error instanceof Error
        ? error.message
        : String(error);
    return { measurement: emptyMeasurement(), itemIds: [], failure: message };
  }
}

/** Render, collect styles, measure — the ordered pipeline for one fixture. */
async function renderAndMeasure(
  options: FixtureRenderOptions,
  cv: CvDocument,
  profile: PageProfile,
  browser: MeasuringBrowser,
): Promise<RenderedFixture> {
  const html = await renderTemplateToHtml({
    templateRoot: options.sourceRoot,
    entry: options.manifest.entry,
    cv,
    profile,
  });

  // AFTER the render. See the ordering note on renderFixture.
  const stylesheets = await collectTemplateStyles({
    templateRoot: options.sourceRoot,
    entry: options.manifest.entry,
  });
  const css = stylesheets.map((sheet) => sheet.content).join('\n');

  const measurement = await measureLayout({ browser, html, css, profile });
  return {
    measurement,
    itemIds: Object.freeze(
      Array.from(
        new Set(
          measurement.boxes
            .map((box) => box.itemId)
            .filter((id): id is string => id !== null && id.length > 0),
        ),
      ),
    ) as readonly ItemId[],
  };
}

/**
 * Split a measured fixture into one `PageContent` per physical page.
 *
 * Page boundaries follow the measured geometry: a box that straddles a page
 * boundary is assigned to the page it *ends* on, and its overflow is recorded
 * so `evaluatePageLayout` reports exactly how much of it hangs past the box.
 * That is the honest reading of a template that ignores break hints — the
 * template chose the layout, and this records the consequence.
 */
function buildPageContents(
  rendered: RenderedFixture,
  pageCount: number,
  pageHeightMm: number,
): readonly PageContent[] {
  const { measurement, itemIds } = rendered;
  const itemOverflowMm: Record<string, number> = {};

  // Attribute each overflowing item to the page whose box it crosses, and
  // record how far past that box it reaches.
  const perPage: (Record<string, number> | undefined)[] = Array.from(
    { length: pageCount },
    () => undefined,
  );
  for (const box of measurement.boxes) {
    if (box.itemId === null) continue;
    const pageIndex = Math.min(pageCount - 1, Math.floor(box.bottomMm / pageHeightMm));
    const pageBottom = (pageIndex + 1) * pageHeightMm;
    const past = box.bottomMm - pageBottom;
    if (past <= 0) continue;
    const bucket = (perPage[pageIndex] ??= {});
    const existing = bucket[box.itemId] ?? 0;
    if (past > existing) bucket[box.itemId] = past;
  }
  for (const bucket of perPage) if (bucket !== undefined) Object.assign(itemOverflowMm, bucket);

  // Content height per page: how much of the fixture's content lands on it.
  const heightForPage = (pageIndex: number): number => {
    if (pageCount === 1) return measurement.contentHeightMm;
    const top = pageIndex * pageHeightMm;
    return Math.max(0, Math.min(pageHeightMm, measurement.contentHeightMm - top));
  };

  const pages: PageContent[] = [];
  for (let index = 0; index < pageCount; index += 1) {
    const pageItemIds =
      index === pageCount - 1
        ? itemIds
        : measurement.boxes
            .filter((box) => box.itemId !== null && box.bottomMm <= (index + 1) * pageHeightMm)
            .map((box) => box.itemId as string);
    pages.push({
      pageNumber: index + 1,
      itemIds: Object.freeze(
        index === pageCount - 1 ? [...itemIds] : [...new Set(pageItemIds)],
      ) as readonly ItemId[],
      contentHeightMm: heightForPage(index),
      ...(Object.keys(itemOverflowMm).length > 0 ? { itemOverflowMm } : {}),
    });
  }
  return Object.freeze(pages);
}

/**
 * A launched browser plus its teardown, held for the whole stage.
 */
interface MeasurementSession {
  readonly browser: MeasuringBrowser;
  close(): Promise<void>;
}

/**
 * Resolve a browser for measuring.
 *
 * `playwright` is an OPTIONAL runtime dependency: the compiler must still
 * work on a host that has no browser (CI, a scaffold smoke test), exactly as
 * `astro check` degrades to `skipped` when `astro` is absent. So the module
 * is loaded through `createRequire` rather than a static `import` — it is
 * genuinely runtime-selected, and a static import would make the package
 * un-typecheckable for anyone without it installed. Returns null when no
 * browser can be had; the caller reports that rather than inventing a
 * measurement.
 */
async function openMeasurementBrowser(
  override: MeasuringPlaywright | undefined,
): Promise<MeasurementSession | null> {
  const playwright = override ?? loadPlaywright();
  if (playwright === null) return null;

  let browser: MeasuringBrowser;
  try {
    browser = await playwright.chromium.launch({ headless: true });
  } catch {
    // Chromium missing or unlaunchable: no measurement is possible.
    return null;
  }
  return {
    browser,
    close: async () => {
      await browser.close().catch(() => {
        // Best-effort teardown.
      });
    },
  };
}

/**
 * Load the optional `playwright` package and verify it has the shape the
 * measurer needs. Returns null when it is absent or unexpected — both mean
 * "cannot measure here", never "measure with a guess".
 */
function loadPlaywright(): MeasuringPlaywright | null {
  try {
    // Playwright ships a CommonJS entry that is more reliable across
    // versions than its ESM facade, so `require` is tried first.
    const required = createRequire(import.meta.url)('playwright') as unknown;
    if (isMeasuringPlaywright(required)) return required;
    return null;
  } catch {
    return null;
  }
}

/** Narrow an unknown loaded module to the measuring subset. */
function isMeasuringPlaywright(value: unknown): value is MeasuringPlaywright {
  if (typeof value !== 'object' || value === null) return false;
  const chromium = (value as { chromium?: unknown }).chromium;
  if (typeof chromium !== 'object' || chromium === null) return false;
  return typeof (chromium as { launch?: unknown }).launch === 'function';
}

/**
 * Outcome when nothing could be measured.
 *
 * This is a `skipped` stage, not a pass: no fixture was laid out, so no claim
 * about overflow was established. `pages`/`hasOverflow` report "nothing
 * measured" (0 pages, no overflow) rather than a fabricated one, and the
 * stage records why. It is deliberately not a failure — a template that
 * cannot be measured on this host is still a valid template, and the
 * artifact is produced. Callers that require a measurement check
 * `diagnostic.level === 'pass'`.
 */
function unmeasuredOutcome(
  options: FixtureRenderOptions,
  fixtures: readonly string[],
  reason: string,
): FixtureRenderOutcome {
  return {
    diagnostic: {
      stage: 'fixture-render',
      level: 'skipped',
      message: `layout was not measured: ${reason}`,
      details: {
        mode: 'skipped',
        reason,
        fixtureCount: fixtures.length,
        fixtureDir: options.fixtureDir,
        sourceRoot: options.sourceRoot,
      },
    },
    diagnostics: aggregateDiagnostics([]),
    pages: 0,
    hasOverflow: false,
    perFixture: [],
  };
}

/** A zero measurement, used when a fixture could not be rendered. */
function emptyMeasurement(): LayoutMeasurement {
  return Object.freeze({
    boxes: Object.freeze([]),
    contentHeightMm: UNMEASURED_HEIGHT_MM,
  });
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