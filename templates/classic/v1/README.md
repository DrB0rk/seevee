# Classic template (v1)

Reusable, single-column, ATS-friendly resume layout for Seevee source templates.

![screenshot placeholder](docs/screenshot.png)

## Layout

- Identity header at the top of the first page (name + contact channels).
- Sections in canonical ATS order: **Summary → Experience → Education → Skills → Projects**.
- All sections share the same single-column flow; no sidebar.
- Inter typography (`Inter, system-ui, sans-serif`) at a default 11pt body size with a 1.4 line height.

## Tokens

| Token | Type | Default | Pagination |
| --- | --- | --- | --- |
| `accent-color` | color | `#1f2937` | no |
| `font-family` | string | `Inter, system-ui, sans-serif` | yes |
| `base-font-size` | number (9–14pt) | `11` | yes |
| `line-height` | number (1.0–2.0) | `1.4` | yes |

## Bindings

The dashboard uses the `data-seevee-*` anchors emitted by `@seevee/template-sdk` to attach section-, item-, and field-level comments.

- `data-seevee-section="<id>"` — wraps each section block.
- `data-seevee-item="<id>"` — wraps each entity item.
- `data-seevee-field-path="<pointer>"` — wraps each `Field` slot.

## File map

- `template.json` — manifest; validates against `templateManifestDocumentSchema`.
- `src/Resume.astro` — the entry Astro component.
- `src/components/SectionHeading.astro` — reusable section heading sub-component.
- `styles/dashboard.css` — stylesheet scoped to this template's live dashboard CV preview.
- `styles/print.css` — `@page` rules and print break hints.
- `fixtures/sparse-cv.json`, `fixtures/normal-cv.json`, `fixtures/dense-cv.json` — sample CV documents for compile-time fixture renders.

## Intended use

Apply to any CV that benefits from a recruiter-friendly one-column layout. The template does not require a CV to have every section — `Summary`, `Experience`, `Education`, `Skills`, and `Projects` are all optional.

The dashboard preview stylesheet uses `.cv-header`, `.cv-section`, `.cv-entry`, `.cv-skill`, and `[data-cv-section-type]` hooks. Its rules are scoped to `.cv-content`; they do not affect the dashboard controls or other templates.
