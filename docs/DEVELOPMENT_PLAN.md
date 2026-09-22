# Development Plan

Status: proposed architecture
Date: 2026-09-23

## 1. Product definition

Seevee is an agent-driven CV authoring system. The user provides arbitrary source material; an ingestion agent extracts and normalizes factual information into a strict CV data model; a design agent creates or selects an Astro CV template; a fixed dashboard renders the result as physical pages; the user can make simple presentation adjustments, add comments and export PDF; agents then apply requested changes through typed, auditable mutations.

The schema layer is the product's primary contract. UI, renderer, agents and exports must all use the same canonical data contracts.

## 2. Core resource separation

Use independent, revisioned resources:

- cv.json — semantic CV graph and factual/generated content.
- provenance.json — evidence and origin assertions for semantic fields.
- presentation.json — document/page settings, template selection, tokens and layout overrides.
- comments.json — review threads, resilient selectors and agent work state.
- workspace.json — active resource IDs, source registry and workspace policy.
- agent-state.json — ephemeral/non-canonical run checkpoints and diagnostics.
- template source — versioned Astro/CSS/assets.
- compiled template artifact — immutable executable render artifact produced after validation.

Never merge these responsibilities into one large document.

## 3. Recommended stack

Use a pnpm TypeScript monorepo.

- Astro in server output mode for studio pages, render routes and API endpoints.
- @astrojs/node for the first persistent self-hosted deployment.
- React islands only for the interactive dashboard.
- Zod 4 as the runtime schema source of truth.
- Generated JSON Schema Draft 2020-12 artifacts for interoperability and model/provider structured outputs.
- Playwright/Chromium for PDF generation and browser-level render diagnostics.
- Vitest for schema/domain tests.
- Playwright Test for editor, visual and export integration tests.
- Server-Sent Events for workspace and agent status updates.
- A file-backed workspace for MVP; PostgreSQL/object storage can replace persistence later without replacing the schemas.

Do not make an experimental Astro API a hard dependency for the core architecture.

## 4. Repository layout

~~~
seevee/
  apps/
    studio/
      src/
        pages/
        dashboard/
        server/
        components/
        styles/
  packages/
    schema/
      src/
        common/
        cv/
        comments/
        provenance/
        presentation/
        workspace/
        template/
        changes/
        migrations/
        semantic-validation/
      generated/json-schema/
    ingest/
    agent/
    renderer/
    export/
    template-sdk/
    template-compiler/
  templates/
    minimal/
    technical/
    editorial/
  workspaces/
  skills/
    seevee-agent/
  docs/
  tests/
    fixtures/
    schema/
    integration/
    visual/
~~~

## 5. Source ingestion

Implement adapters behind one interface:

- pasted/plain text;
- Markdown;
- JSON/YAML;
- PDF;
- DOCX;
- HTML/URL;
- images/screenshots through an explicitly configured vision model;
- structured profile exports later.

Every adapter produces an ExtractedDocument containing source ID, source hash, MIME/type, text/structural blocks, stable locators, warnings and retrieval metadata.

For PDF/DOCX, perform deterministic extraction before OCR/vision. For URLs, enforce SSRF protections and never execute fetched scripts.

Use two conceptual agent stages:

Extraction:
- extract candidate facts;
- attach source locators;
- preserve uncertainty;
- do not silently reconcile contradictions.

Normalization:
- deduplicate equivalent entities;
- merge compatible evidence;
- surface conflicts;
- assign stable semantic IDs;
- propose CV/provenance changes.

Model output is always schema validated before mutation.

## 6. Agent roles

Ingestion agent:
- reads extracted sources, CV and provenance;
- proposes factual nodes and provenance assertions;
- cannot edit template source.

CV editor agent:
- improves summaries and bullet wording;
- applies content comments;
- cannot invent unsupported facts.

Design agent:
- reads CV;
- edits presentation;
- creates/forks template source;
- cannot mutate CV facts.

Comment-fix agent:
- resolves comment selectors;
- classifies each request;
- delegates to the narrowest mutation surface.

QA process:
- structural schema validation;
- semantic reference validation;
- template safety/build checks;
- render success;
- overflow/clipping diagnostics;
- page-count constraints;
- asset/font checks;
- PDF validity and dimensions;
- unresolved blocking conflicts/comments.

Use deterministic checks for pass/fail wherever possible.

## 7. Agent mutation boundary

Do not give the application agent unrestricted filesystem access.

Expose typed tools such as:

- get_cv
- get_presentation
- get_provenance
- list_sources
- propose_cv_changes
- propose_presentation_changes
- list_templates
- read_template
- create_template_draft
- patch_template_file
- validate_template
- compile_template
- render_preview
- inspect_layout
- list_comments
- update_comment_work_state
- export_pdf

Every write includes a base revision. Stale writes fail and must be rebased.

## 8. Template lifecycle

Separate source templates from style presets.

A source template is Astro/CSS/asset code that defines structure and visual language.

A style preset is JSON that references a source template and stores safe presentation-token overrides. The dashboard action Save current style as template should create a style preset by default. A separate Fork as independent template action creates a new source-template identity.

Source-template creation lifecycle:

1. agent writes a template draft in an isolated workspace;
2. static/source security validation runs;
3. Astro/compiler checks run;
4. representative sparse/normal/dense fixtures render;
5. A4 page diagnostics run;
6. template is compiled in a restricted build worker;
7. resulting immutable artifact is registered;
8. artifact becomes selectable/active.

Data and presentation-token edits do not require recompiling source.

In local development, the project may use Astro/Vite HMR for convenience. Hosted production should activate validated compiled artifacts, not execute a mutable development server as its trust boundary.

## 9. Fixed dashboard/editor

The dashboard is intentionally not agent-generated.

Recommended layout:

- fixed top toolbar;
- left workspace/data rail;
- centered physical-page canvas;
- right contextual inspector/comments panel.

Simple but useful controls:

- A4, Letter and custom page profiles;
- portrait/landscape;
- margins;
- target/max page count;
- zoom, fit page, fit width;
- template picker;
- create template;
- save style preset;
- fork template;
- comment mode;
- validation/overflow indicator;
- agent-run status;
- revision/undo history;
- PDF export.

Default: ISO A4 portrait, exactly 210 x 297 mm.

The editor is not a generic Figma-style layout builder. Complex layout work belongs to the design agent/template; the dashboard exposes predictable presentation controls.

## 10. Pagination and diagnostics

Render explicit physical Page surfaces rather than one unlimited HTML canvas.

A content block can declare break behavior:

- avoid;
- split;
- page-before;
- page-after.

The renderer measures every bound semantic element against the page content box and reports:

- overflow amount;
- clipped node IDs;
- blank pages;
- near-overflow warnings;
- orphan headings;
- missing assets;
- font substitutions;
- page count.

Never hide overflow to make validation pass.

## 11. PDF export

Use a dedicated render route that excludes dashboard UI.

Export:

1. validate canonical resources;
2. load selected compiled template;
3. render using the exact active page profile;
4. wait for fonts/images;
5. run layout diagnostics;
6. block on fatal clipping/overflow unless policy explicitly allows forced export;
7. call Playwright PDF with print backgrounds and CSS page sizing;
8. verify page count and physical dimensions;
9. store export metadata/hash;
10. return the PDF.

Do not maintain a separate PDF-only template implementation.

## 12. Live updates

Use typed server events:

- cv.updated
- provenance.updated
- presentation.updated
- comments.updated
- template.build.started
- template.build.completed
- template.activated
- agent.run.started
- agent.run.completed
- diagnostics.updated
- export.completed

When a resource changes, the dashboard reloads only affected state, rerenders the CV canvas and reanchors comments.

Never stream half-written JSON. Canonical files use atomic replace and revision checks.

## 13. Security

Treat uploads, remote URLs, model output and generated source as untrusted.

Requirements:

- upload size/type limits;
- path traversal prevention;
- URL SSRF protections;
- no source-script execution during ingestion;
- template import allowlist;
- no filesystem/process/env/arbitrary network access from templates;
- isolated template compilation with CPU/memory/time limits;
- read-only dependency set;
- no runtime package install;
- safe asset handling;
- authenticated dashboard in hosted mode;
- explicit secret separation from workspace files.

## 14. Testing strategy

Schema:
- valid/invalid fixtures per module;
- property-level edge cases;
- cross-reference semantic tests;
- migration tests;
- old-version fixtures.

Ingestion:
- deterministic adapter fixtures;
- duplicated/conflicting source cases;
- provenance completeness.

Comments:
- reorder node after comment;
- rewrite selected text;
- delete target;
- template switch;
- repagination;
- ambiguous fallback.

Rendering:
- sparse/normal/dense CV fixtures;
- A4 default;
- Letter/custom profiles;
- one/two/multi-page cases;
- long URLs/words;
- missing optional sections;
- international text.

Templates:
- forbidden imports;
- invalid manifests;
- compile failures;
- token compatibility;
- fixture visual regression.

Export:
- PDF dimensions;
- page count;
- backgrounds/fonts;
- clipping checks;
- repeatability.

## 15. Implementation phases

Phase 0 — contracts:
- implement packages/schema;
- generate JSON Schema artifacts;
- semantic validators;
- fixtures and migrations;
- change-set model;
- comment target resolver.

Phase 1 — renderer skeleton:
- minimal Astro template;
- A4 page model;
- render route;
- layout diagnostics;
- Playwright export.

Phase 2 — fixed dashboard:
- workspace browser;
- paged canvas;
- editor controls;
- inspector;
- comments overlay;
- SSE updates.

Phase 3 — ingestion:
- text/Markdown/JSON;
- PDF/DOCX;
- provenance;
- conflict UI;
- structured-output agent adapter.

Phase 4 — agent editing:
- content mutation tools;
- presentation tools;
- comment-fix orchestration;
- run/audit history.

Phase 5 — template platform:
- manifest/SDK;
- template validator;
- compiler worker;
- generated templates;
- style presets;
- fork workflow.

Phase 6 — robustness:
- history/undo;
- auth;
- hosted persistence;
- collaboration;
- performance;
- accessibility;
- deployment hardening.

## 16. MVP acceptance criteria

The MVP is complete only when:

- multiple source types can become a validated CV graph;
- provenance exists for extracted factual fields;
- the default CV renders as true A4 pages;
- the fixed dashboard live-updates the preview;
- a user can change basic page/presentation settings;
- at least two source templates work;
- a style can be saved as a reusable preset;
- a generated/forked source template can be validated, compiled and activated;
- comments can target semantic nodes/fields and rendered fallback regions;
- an agent can apply a comment through typed mutations;
- comment links survive reordering and ordinary wording changes;
- layout diagnostics detect clipping/overflow;
- PDF export matches preview page geometry;
- schema, semantic and export tests pass.
