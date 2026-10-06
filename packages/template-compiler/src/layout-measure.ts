// Real layout measurement for the fixture-render stage.
//
// The stage answers "does this template overflow an A4 page when fed this
// fixture?", so it needs the template's ACTUAL laid-out height. Neither half
// of that is available from `renderTemplateToHtml` on its own:
//
//   1. The template's compiled scoped CSS. Astro's container renders in
//      "partial" mode, which suppresses head injection, so the fragment
//      carries `class="classic-name"` with nothing styling it. Measuring the
//      bare fragment would report an unstyled layout and miss overflows the
//      real template produces. `collectTemplateStyles` (same package, same
//      cached dev server) is where the compiled CSS comes from — see the
//      ORDERING note on that function: it must be called *after* the render.
//   2. A layout engine. Millimetre constants cannot know how tall a wrapped
//      heading actually is, so heights come from a real browser.
//
// Chromium is resolved the same optional way `@seevee/export` resolves
// Playwright: probe the host tree, and when it is absent say so plainly
// rather than inventing a number. ./fixture-render.ts decides what that
// means for the compile.

import { contentBoxMm } from '@seevee/template-sdk';
import type { PageProfile } from '@seevee/schema';

/** CSS pixels per millimetre at the CSS reference resolution of 96dpi. */
const PX_PER_MM = 96 / 25.4;

/**
 * One laid-out box, in millimetres measured from the top of the page's
 * content area. Both edges are measured, not derived: which edge decides a
 * page break depends on the item's `breakBehavior`, and the caller does not
 * know it — the browser does.
 */
interface MeasuredBox {
  /** `data-seevee-item` id, or null for a box that is not an item. */
  readonly itemId: string | null;
  readonly topMm: number;
  readonly bottomMm: number;
}

/** Everything the browser learned about one rendered fragment. */
export interface LayoutMeasurement {
  /** Laid-out boxes in document order, excluding the page's own padding. */
  readonly boxes: readonly MeasuredBox[];
  /** Furthest content bottom reached inside the page, in mm from content top. */
  readonly contentHeightMm: number;
}

/**
 * The subset of Playwright this module drives. Structural typing keeps
 * `playwright` an optional peer and lets tests inject a fake browser.
 */
export interface MeasuringPlaywright {
  readonly chromium: {
    launch(options?: {
      readonly headless?: boolean;
      readonly args?: readonly string[];
    }): Promise<MeasuringBrowser>;
  };
}

export interface MeasuringBrowser {
  newPage(): Promise<MeasuringPage>;
  close(): Promise<void>;
}

export interface MeasuringPage {
  setContent(
    html: string,
    options?: { readonly waitUntil?: 'load' | 'domcontentloaded' | 'networkidle' },
  ): Promise<void>;
  evaluate<T>(fn: string): Promise<T>;
  close(): Promise<void>;
}

/**
 * Assemble the measuring document: the template's own stylesheet verbatim
 * (the `data-astro-cid-*` selectors are load-bearing — stripping them would
 * silently unstyle every rule), the page profile's geometry, and the
 * fragment.
 *
 * The harness stylesheet resets only what the browser would otherwise inject
 * — `body { margin: 0 }` above all, whose 8px would be counted as content.
 * Everything else is the template's, so what gets measured is the template's
 * layout and not the harness'.
 */
function buildMeasureDocument(options: {
  readonly html: string;
  readonly css: string;
  readonly profile: PageProfile;
}): string {
  const box = contentBoxMm(options.profile);
  const edges = options.profile.edges ?? { top: 0, right: 0, bottom: 0, left: 0 };
  return [
    '<!doctype html><html><head><meta charset="utf-8">',
    `<style>${options.css}</style>`,
    '<style>',
    'html,body{margin:0;padding:0;background:#fff;}',
    // `content-box` so the padding below insets the content area by exactly
    // the margins `contentBoxMm` subtracted, making the two comparable.
    '[data-seevee-page]{box-sizing:content-box;',
    `width:${box.width}mm;`,
    `padding:${edges.top}mm ${edges.right}mm ${edges.bottom}mm ${edges.left}mm;`,
    '}',
    '</style></head><body>',
    options.html,
    '</body></html>',
  ].join('\n');
}

/**
 * Runs in the page. Every DOM and layout concern stays in the browser, where
 * the layout engine is: this returns raw geometry in millimetres relative to
 * the page element's border box, and no arithmetic happens in Node.
 *
 * Every descendant is measured, not just `[data-seevee-item]`, because a
 * template legitimately renders content outside item anchors — the identity
 * header in `templates/classic` is one — and that content occupies page
 * space just as much.
 */
const MEASURE_SCRIPT = `(() => {
  const PX_PER_MM = ${PX_PER_MM};
  const page = document.querySelector('[data-seevee-page]');
  if (page === null) return { ok: false, reason: 'no-page-element' };

  const origin = page.getBoundingClientRect().top;
  const boxes = [];
  let furthest = 0;

  for (const el of page.querySelectorAll('*')) {
    const rect = el.getBoundingClientRect();
    const style = getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden') continue;
    // Collapsed boxes (an empty grid track, a zero-height spacer) contribute
    // no height and would only add noise to the box list.
    if (rect.height === 0 && rect.width === 0) continue;

    const topMm = (rect.top - origin) / PX_PER_MM;
    const bottomMm = (rect.bottom - origin) / PX_PER_MM;
    // Ignore boxes that sit entirely outside the content area (a
    // deliberately positioned bleed element) so they cannot inflate it.
    if (bottomMm <= 0) continue;

    boxes.push({
      itemId: el.getAttribute('data-seevee-item'),
      topMm: topMm,
      bottomMm: bottomMm,
    });
    if (bottomMm > furthest) furthest = bottomMm;
  }

  return { ok: true, boxes: boxes, contentHeightMm: furthest };
})()`;

interface RawMeasurement {
  readonly ok: boolean;
  readonly reason?: string;
  readonly boxes?: readonly {
    readonly itemId: string | null;
    readonly topMm: number;
    readonly bottomMm: number;
  }[];
  readonly contentHeightMm?: number;
}

/**
 * Measure one rendered fragment in an already-launched browser.
 *
 * The browser is passed in rather than launched here so the caller can keep
 * one browser alive across every fixture: a launch costs ~140ms against a
 * ~20ms measurement, so launching per fixture would dominate the stage. The
 * caller owns the browser's lifetime and closes it once.
 *
 * Each measurement still gets its own page, and closes only that page.
 */
export async function measureLayout(options: {
  readonly browser: MeasuringBrowser;
  readonly html: string;
  readonly css: string;
  readonly profile: PageProfile;
}): Promise<LayoutMeasurement> {
  const page = await options.browser.newPage();
  try {
    await page.setContent(
      buildMeasureDocument({
        html: options.html,
        css: options.css,
        profile: options.profile,
      }),
      { waitUntil: 'load' },
    );
    const raw = await page.evaluate<RawMeasurement>(MEASURE_SCRIPT);
    if (raw.ok !== true) {
      throw new Error(
        `rendered template has no [data-seevee-page] root element (${raw.reason ?? 'unknown'})`,
      );
    }
    const round = (value: number): number => Number(value.toFixed(3));
    return Object.freeze({
      boxes: Object.freeze(
        (raw.boxes ?? []).map((box) =>
          Object.freeze({
            itemId: box.itemId,
            topMm: round(box.topMm),
            bottomMm: round(box.bottomMm),
          }),
        ),
      ),
      contentHeightMm: round(raw.contentHeightMm ?? 0),
    });
  } finally {
    await page.close().catch(() => {
      // Best-effort teardown; a failure here must not mask the real error.
    });
  }
}