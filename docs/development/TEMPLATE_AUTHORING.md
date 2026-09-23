# Template Authoring and Rendering

Status: architecture contract
Date: 2026-09-23

## 1. Template model

A Seevee source template is a versioned Astro/CSS/assets package.

It defines:

- structural layout;
- typographic hierarchy;
- CV section components;
- responsive-to-page behavior;
- semantic DOM bindings;
- supported presentation tokens;
- print rules.

It does not own CV facts.

## Design freedom

Seevee does not prescribe a CV visual system.

Template authors and user-selected agents may use arbitrary Astro/CSS composition inside the safety boundary, including:

- single or multi-column layouts;
- unusual grids;
- custom typography;
- colour;
- illustration and approved images;
- decorative elements;
- content-specific compositions;
- templates written specifically around one exact CV;
- custom physical page sizes.

Interchangeability is the default data model, not a requirement that every template must make every CV look good.

A template manifest may describe its design intent as reusable, targeted, or bespoke. That metadata is advisory only and never prevents a user from applying it to another CV.

## 2. Directory contract

~~~text
templates/<template-id>/<version>/
  template.json
  src/
    Resume.astro
    components/
  styles/
  assets/
~~~

All dependencies come from the project's approved template SDK/dependency allowlist.

A template may not add arbitrary package dependencies.

## 3. Template SDK

Create `@seevee/template-sdk` with:

- typed CV read model;
- presentation read model;
- Page component;
- Section component helpers;
- semantic binding helpers;
- safe asset helpers;
- print utilities;
- diagnostics hooks.

Example conceptual Astro usage:

~~~astro
---
const { cv, presentation, bind } = Astro.props;
const experience = getSection(cv, "experience");
---

<section {...bind.section(experience.id)}>
  {experience.items.map((item) => (
    <article {...bind.node(item.id, "experience")}>
      <h3 {...bind.field(item.id, "experience", "/role/title")}>
        {item.role.title}
      </h3>
    </article>
  ))}
</section>
~~~

The exact API can evolve; the invariant is that templates expose stable semantic bindings instead of making the dashboard infer identity from CSS selectors or DOM order.

## 4. Source-template safety policy

Reject templates containing or importing:

- Node filesystem APIs;
- process spawning;
- environment access;
- arbitrary HTTP clients/network access;
- dynamic eval/new Function;
- server endpoints;
- server actions;
- database access;
- runtime package installation;
- imports outside the template package and allowlist.

Compile in an isolated worker/container with:

- no secrets;
- no write access outside scratch/build directories;
- no unrestricted network;
- CPU timeout;
- memory limit;
- output-size limit.

## 5. Compilation lifecycle

A source-template change is a build event, not merely a JSON update.

~~~text
draft source
  -> static policy scan
  -> schema/manifest validation
  -> Astro/type checks
  -> fixture renders
  -> layout diagnostics
  -> build artifact
  -> artifact registration
  -> activation
~~~

If any required stage fails, the active template remains unchanged.

## 6. Development versus production

Local development may use Astro/Vite HMR to make authoring fast.

Hosted production should not expose a long-running mutable development server as the execution model for arbitrary agent source changes.

Instead:

- save source draft;
- compile/version it;
- activate the compiled artifact;
- serve/rerender CV data against that artifact.

Ordinary CV and presentation changes remain instant because they do not change source code.

## 7. Template manifest

See docs/development/SCHEMA_ARCHITECTURE.md.

The manifest declares:

- template/version identity;
- entry file;
- supported CV/presentation schema ranges;
- capabilities;
- presentation tokens;
- semantic render bindings;
- migration compatibility metadata.

## 8. Presentation tokens

Template authors may expose useful dashboard controls for convenience. This is optional and does not replace or constrain arbitrary template CSS.

Examples:

- fontFamily;
- baseFontSizePt;
- lineHeight;
- headingScale;
- density;
- accentColor;
- mutedColor;
- columnGapMm;
- leftColumnRatio;
- borderStyle;
- iconStyle.

If a template exposes a token, it declares:

- type;
- default;
- constraints/options;
- dashboardEditable;
- whether changing it can alter pagination.

## 9. Page model

Seevee's default new-presentation profile is A4 portrait:

~~~text
width: 210mm
height: 297mm
~~~

Render physical pages using CSS print/page rules plus explicit page containers for the dashboard.

The renderer must know:

- physical page dimensions;
- margins;
- content box;
- section break hints;
- measured semantic blocks.

## 10. Pagination

Avoid relying on accidental browser overflow.

Each rendered semantic block may provide a break policy:

- normal/splittable;
- avoid;
- force before;
- force after.

The renderer/diagnostics layer should detect:

- content outside content box;
- clipped node;
- heading left alone at page bottom;
- unintended blank page;
- page count > configured maximum.

A template may use CSS fragmentation rules, but diagnostics remain authoritative for acceptance.

## 11. Comment bindings

Every user-meaningful area should bind to the strongest semantic object available.

Examples:

- name -> identity field;
- headline -> identity field;
- summary -> identity summary;
- experience card -> experience node;
- role title -> experience field;
- bullet -> bullet node/field;
- entire section -> section ID;
- purely decorative area -> template binding only.

Rendered DOM should include machine-readable binding metadata through the SDK. Do not require the editor to scrape textual content to establish primary identity.

## 12. Representative fixtures

Reusable built-in templates should be tested against:

- sparse one-page CV;
- normal CV;
- dense CV;
- long URLs;
- long organization/role names;
- missing optional identity fields;
- many bullets;
- international Unicode text;
- multiple pages.

A4 is the default built-in test profile. A targeted/bespoke template may instead declare and test only the page profiles it intentionally supports. No visual layout style is mandatory.

## 13. Style presets

Style presets store presentation values, not source.

When a user clicks Save current style:

1. capture presentation/page fields exposed by the active template;
2. reference the active template/version;
3. create style-preset JSON;
4. add it to the template browser.

When a user needs structural independence:

1. fork template source;
2. create new template ID/version lineage;
3. compile and activate;
4. optionally seed it from current presentation tokens.

## 14. PDF export

Use one render implementation.

The dedicated export route:

- loads canonical CV;
- loads presentation;
- loads compiled template;
- renders without dashboard chrome;
- waits for fonts/assets;
- verifies diagnostics;
- prints via Playwright/Chromium;
- uses CSS page size;
- prints backgrounds;
- verifies resulting physical page geometry.

Do not maintain a separate PDF component tree.

## 15. Template completion checklist

Before activation:

- manifest valid;
- compatibility ranges valid;
- forbidden imports absent;
- Astro/type checks pass;
- semantic bindings present;
- appropriate reusable fixtures render, or for a bespoke template its declared target CV fixture renders;
- declared physical page dimensions are correct;
- no clipping;
- no unexpected overflow;
- fonts/assets load;
- export route succeeds;
- resulting PDF page count/dimensions match expectations.
