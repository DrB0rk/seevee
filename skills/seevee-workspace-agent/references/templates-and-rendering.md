# Seevee templates and rendering

## Fixed editor versus generated canvas

The dashboard is fixed application UI. Agents modify the CV canvas, not the dashboard shell. Seevee does not prescribe CV styling or layout.

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
