# @seevee/renderer

Deterministic physical-page renderer for Seevee CV/Presentation documents
with per-page layout diagnostics.

## Scope

The renderer takes a validated CV document (parsed via `@seevee/schema`)
plus a page-profile descriptor (preset name + optional dimensions and
margins) and produces:

1. An HTML document with one `<article class="seevee-page">` per
   physical page, carrying the same `data-seevee-*` attribute hooks
   the dashboard uses to anchor comments and partial-rerender slots.
2. A `RenderDiagnostics` record with per-page overflow, clipped-node,
   and blank-page metadata aggregated into a render-wide summary.

The MVP uses fixed per-item-type height constants for measurement —
real text measurement lands in a later iteration. The estimator is
deliberately conservative so dense CVs break across multiple pages
rather than overflowing a single page silently.

## Public API

```ts
import {
  renderCvToPages,
  renderPresentationToHtml,
  buildReadModel,
  measureOverflow,
  paginate,
  type RendererOptions,
  type RenderResult,
} from '@seevee/renderer';
```

### `renderCvToPages(cv, options)`

Render a CV into a `RenderResult` containing the HTML document,
per-page diagnostics, and an aggregated `RenderDiagnostics` record.

```ts
const result = renderCvToPages(cvDocument, {
  pageProfile: 'A4',
  maxPages: 16,
});
```

`RendererOptions`:

- `pageProfile` — `'A4'`, `'Letter'`, or a `Custom` profile carrying
  `width`, `height`, and optional `margins` (mm) and `orientation`.
- `templateManifest`, `templateSource` — accepted today so the public
  surface stays stable; unused until the renderer learns to evaluate
  a compiled template.
- `fonts` — resolved font file paths keyed by font-family.
- `maxPages` — upper bound on rendered pages; defaults to 64.
- `presentation` — optional `PresentationDocument` whose page profile
  and `pagination.breakBehavior` are honoured.

### `renderPresentationToHtml(presentation, cv, options)`

Render a presentation by chaining the referenced CV through
`renderCvToPages`. The presentation supplies the page profile and
pagination policy; the CV supplies the data.

### `buildReadModel(cv, options?)`

Build the paginator's `CvReadModel` and a flat list of
`PaginatorItem`s. Exposed so callers can run their own paginator or
inspect the item stream before rendering.

### `measureOverflow(items, pageHeightMm)`

Sum the heights of the supplied items and return the page height, the
overflow amount in mm past `pageHeightMm`, and a `fits` boolean.

### `paginate(items, options)`

The standalone paginator. Walks items respecting each item's
`breakBehavior` and returns the page boundaries, per-item overflow
map, and unclippable-overflow record.

## Page profiles

| Preset     | Portrait (mm)         | Margins (default) |
| ---------- | --------------------- | ----------------- |
| `A4`       | 210 × 297             | 12 mm all edges   |
| `Letter`   | 215.9 × 279.4         | 12 mm all edges   |
| `Custom`   | caller-supplied       | 12 mm all edges   |

Custom profiles accept an explicit `width`, `height`, optional
`margins`, and optional `orientation`. The renderer rejects profiles
with non-positive dimensions or missing width/height for `Custom`.

The rendered HTML carries an `@page { size: …mm …mm; margin: …mm
…mm …mm …mm; }` rule so browsers and headless renderers see the exact
physical dimensions rather than locale-dependent name resolution.

## Diagnostic guarantees

The renderer never hides overflow to make validation pass:

- Items marked `breakBehavior: 'avoid'` are placed whole; if they
  don't fit on the current page, the renderer emits a `page-before`
  break and places the item on the next page. If even a fresh page
  can't hold the item, the diagnostic record carries the overflow
  amount and the affected item IDs.
- Items marked `'page-before'` always start on a new page.
- Items marked `'page-after'` always end the current page.
- Items marked `'auto'` flow normally; if they don't fit on the
  current page, the renderer closes the page and starts a new one
  (or, when the item is itself larger than a page, surfaces the
  overflow in the diagnostic record).
- Pages with no items are flagged `blankPage: true`.
- The aggregate `RenderDiagnostics` exposes `totalOverflow`,
  `hasClipping`, `hasBlankPages`, deduplicated `fontSubstitutions`,
  and deduplicated `missingAssets`.

## Output HTML structure

```html
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>{cv.identity.name.display}</title>
  <style>
    @page { size: 210mm 297mm; margin: 12mm 12mm 12mm 12mm; }
    .seevee-page { ... }
    [data-seevee-section] { display: block; }
    [data-seevee-item] { display: block; }
    [data-seevee-field] { display: inline; }
  </style>
</head>
<body>
  <article class="seevee-page" data-page="1">
    <section data-seevee-section="sec_summary" data-seevee-section-title="Summary">
      <h2 class="seevee-section-title">Summary</h2>
      ...
    </section>
  </article>
</body>
</html>
```

## Determinism

The renderer is pure: the same inputs always produce the same
`html`, the same `pages`, and the same `diagnostics`. There is no
randomness, no filesystem lookup, and no network access. Tests pin
page boundaries for representative fixtures.
