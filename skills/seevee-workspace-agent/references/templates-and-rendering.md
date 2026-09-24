# Seevee templates and rendering

## Fixed editor versus generated canvas

The dashboard is fixed application UI. Agents modify the CV canvas, not the dashboard shell. Seevee does not prescribe CV styling or layout.

## Design freedom

Treat the user's visual direction as the design brief. The CV canvas may use any visual structure that fits the content and page profile: CSS Grid, Flexbox, multiple columns, sidebars, asymmetric compositions, timelines, cards, rules, color systems, custom typography, and image assets are all available. Do not force a design into Classic, the bundled Two-Column template, one-column ATS styling, or the dashboard's available token controls when the brief calls for something else.

The bundled templates are examples and starting points only. For a distinct structure or style, fork a source template or create a bespoke local Astro/CSS template and register it with the presentation. Source-level design does not need to be expressible as dashboard tokens. Preserve semantic bindings for editable/commentable content, accessibility, selected physical page dimensions, page breaks, and export diagnostics while designing freely.

Keep each template's dashboard preview styles in its own `styles/dashboard.css`. The Studio loads that file for the selected template and scopes it to `.cv-content`; it cannot style the dashboard shell or another template. Use the preview hooks (`.cv-header`, `.cv-section`, `.cv-entry`, `.cv-skill`, and `[data-cv-section-type]`) for the dashboard's editable preview. Keep template print rules in `styles/print.css`. Never change the Studio's `dashboard.css` to style a CV.

## Static document and PDF constraints

The CV itself is a document that must remain complete and readable when printed or exported to PDF. Treat the rendered CV as static content:

- Do not add scrollable regions to the CV, including `overflow: auto`/`scroll`, fixed or max-height content panels, or nested scroll areas. Let the document paginate across physical pages instead.
- Do not add interaction-dependent CV content such as buttons, form controls, tabs, accordions, carousels, expandable/collapsible sections, or content revealed only by JavaScript, hover, or focus. Keep all CV information visible in the rendered pages.
- Keep dashboard editing controls in the dashboard shell. Never render editor inputs, buttons, or other controls as part of the CV template or its exported document.
- Static hyperlinks may be included when useful, but their visible text must remain understandable in print. Do not rely on clicking to reveal essential information.
- Do not use `position: fixed` or screen-only overlays for CV content. Avoid clipping content with `overflow: hidden`; use the page profile, natural page breaks, and layout diagnostics to fit and paginate it.

These constraints apply to the CV/template output, not to Seevee's surrounding dashboard interface. Custom grids, columns, sidebars, and other static layouts remain available as long as their content flows and paginates within the selected page size.

The canvas renders one or more physical pages. Default:

- preset: A4;
- orientation: portrait;
- width: 210 mm;
- height: 297 mm;
- configurable margins;
- zero bleed unless explicitly enabled.

The same page profile drives dashboard preview and PDF export.

## Source template versus style preset

A source template is Astro/CSS/asset code defining structure and visual language. It may be reusable or completely bespoke to one CV.

A style preset is data referencing a source template and overriding safe presentation tokens. Saving the current style should create a style preset by default. Fork source only when structural/template-code independence is required.

Every new CV must have a registered presentation and a visible source-template style. When the user gives no visual direction, use the installed `classic` template and its declared defaults as the starting design; do not leave a new CV as unstyled data or ask for setup before showing a first result.

## Template inputs

A template receives only validated inputs:

- CV document/read model;
- presentation document;
- template manifest;
- render context/diagnostics helpers.

Do not read workspace files directly from a template.

## Binding contract

Use template SDK helpers to attach stable bindings to commentable DOM nodes. At minimum, expose semantic node ID, optional field pointer and section ID. Bindings must survive visual changes whenever the semantic target remains the same.

Do not derive semantic identity from CSS selectors or DOM position.

## Template safety

Generated templates must not contain:

- filesystem/process imports;
- environment-variable access;
- arbitrary outbound networking;
- dynamic eval/new Function;
- server endpoints/actions;
- package installation/runtime dependency changes;
- imports outside the approved SDK/dependency allowlist.

Validate source before making it active.

## Page-aware layout

Every layout must be evaluated against a physical content box. Content blocks declare break behavior where needed:

- keep together when possible;
- splittable;
- force page before;
- force page after.

Diagnostics should identify clipped semantic node IDs, overflow amount, blank pages, orphan headings and near-overflow.

Do not hide overflow merely to make a validation warning disappear.
Before activating a template, inspect its rendered output and print stylesheet for scroll containers, controls, hidden/revealed content, clipping, and page-break behavior.

## Presentation tokens

Templates may expose data-driven tokens for convenient dashboard changes, but this is optional. When useful, tokens can cover:

- font family and fallbacks;
- scale/type ramp;
- line height;
- colors;
- spacing/density;
- rule/border styling;
- column ratio/gap;
- section ordering/visibility overrides;
- icon treatment;
- page/margins.

If a token exists, it must declare type, supported range/options, default and whether the dashboard may expose it. Lack of exposed tokens does not restrict source-level Astro/CSS design.

## Export readiness

Before PDF export:

1. validate canonical documents;
2. load the dedicated render route without dashboard code;
3. wait for fonts/images;
4. run layout diagnostics;
5. block on clipping/overflow unless force-export policy permits it;
6. render using CSS `@page` and the selected physical size;
7. print backgrounds;
8. prefer CSS page size;
9. verify resulting page dimensions/count.
