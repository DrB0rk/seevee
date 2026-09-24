# Two-Column template (v1)

Reusable two-column resume layout: a sidebar for identity, contact, skills, and education; a main column for summary, experience, and projects.

![screenshot placeholder](docs/screenshot.png)

## Layout

- **Sidebar** (~34% of the content box): identity header + contact channels + Skills + Education.
- **Main column** (the rest): Summary → Experience → Projects.
- Inter typography at a default 10.5pt body size with a 1.35 line height; tighter than Classic to make room for both columns.

## Tokens

| Token | Type | Default | Pagination |
| --- | --- | --- | --- |
| `accent-color` | color | `#0f172a` | no |
| `font-family` | string | `Inter, system-ui, sans-serif` | yes |
| `base-font-size` | number (9–14pt) | `10.5` | yes |
| `line-height` | number (1.0–2.0) | `1.35` | yes |
| `sidebar-ratio` | number (0.2–0.5) | `0.34` | yes |
| `column-gap` | number (2–12mm) | `5` | yes |

## Bindings

The dashboard uses the `data-seevee-*` anchors emitted by `@seevee/template-sdk`:

- `data-seevee-section="<id>"` — wraps each section.
- `data-seevee-item="<id>"` — wraps each entity item.
- `data-seevee-field-path="<pointer>"` — wraps each `Field` slot.

## File map

- `template.json` — manifest; validates against `templateManifestDocumentSchema`.
- `src/Resume.astro` — the entry Astro component.
- `src/components/SidebarSection.astro` — reusable sidebar section wrapper.
- `styles/dashboard.css` — stylesheet scoped to this template's live dashboard CV preview.
- `styles/print.css` — `@page` rules and print break hints.
- `fixtures/sparse-cv.json`, `fixtures/normal-cv.json`, `fixtures/dense-cv.json` — sample CV documents for compile-time fixture renders.

## Intended use

Apply to any CV with enough material to fill both columns. The template degrades gracefully when sections are missing: an empty Skills section renders no items, and an empty Experience section still keeps the summary at the top of the main column.

The dashboard preview stylesheet uses `.cv-header`, `.cv-section`, `.cv-entry`, `.cv-skill`, and `[data-cv-section-type]` hooks. Its rules are scoped to `.cv-content`; they do not affect the dashboard controls or other templates.
