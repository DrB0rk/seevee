# Seevee schema specification

This directory is the machine-readable bootstrap specification for Seevee's v1 contracts.

## Canonical implementation rule

During implementation, the runtime source of truth moves to Zod modules in `packages/schema/src`. CI must generate Draft 2020-12 JSON Schema artifacts and compare them with the committed files here (or replace this directory with the generated output path). Do not maintain two manually divergent schema systems.

## Files

- `common.schema.json` — IDs, timestamps, partial dates, semantic references and shared primitives.
- `cv.schema.json` — canonical CV semantic graph.
- `source.schema.json` — normalized source/extraction representation before CV mutation.
- `provenance.schema.json` — evidence and source locators linked to CV semantic targets.
- `presentation.schema.json` — page profile, selected template, presentation tokens and section overrides.
- `comments.schema.json` — review threads and resilient selector stacks.
- `workspace.schema.json` — `seevee.json` multi-CV workspace library/index.
- `change-set.schema.json` — revision-safe, ID-aware mutations.
- `template-manifest.schema.json` — Astro template capabilities, bindings and editable token contract.
- `style-preset.schema.json` — reusable presentation preset referencing a source template.
- `agent-run.schema.json` — auditable agent execution summary.
- `render-diagnostics.schema.json` — deterministic render/export diagnostics.

## Multi-CV resource model

A workspace stores each CV as its own complete JSON document under `cvs/`. Presentations are separate resources that explicitly bind one CV ID to one template/version.

This keeps content and design independently interchangeable:

~~~text
cvs/backend.json ─────┐
                      ├─ presentation ─ template/minimal
cvs/security.json ────┘

cvs/backend.json ───── presentation ─ template/bespoke-backend
~~~

A template manifest may describe itself as reusable, targeted, or bespoke. That metadata is advisory and never a hard compatibility block.

## Linking model

One reference vocabulary is shared everywhere:

- NodeRef: semantic node identity.
- FieldRef: node identity plus a JSON Pointer relative to that node.
- SectionRef: stable section identity.

Comments and provenance use these same references. Change sets mutate these same references. Templates expose these identities through render bindings. This avoids translation layers where each subsystem invents a different path to the same CV field.

## Comment resilience

A comment stores an ordered selector stack. Strong semantic selectors come first; textual and rendered selectors are fallbacks:

~~~text
FieldSelector / NodeSelector
  -> SectionSelector
  -> RenderBindingSelector
  -> TextQuoteSelector
  -> PageRegionSelector
~~~

The semantic resolver must never silently choose between equally plausible fallback matches. Mark the comment ambiguous/blocked.

## Structural versus semantic validation

JSON Schema validates document shape. It cannot prove every cross-file invariant.

The semantic validation package must additionally verify:

- ordered ID arrays match their keyed stores;
- section item references resolve;
- bullet order entries resolve to bullet nodes;
- links/skills referenced from entities resolve;
- comment/provenance targets resolve or carry an allowed orphan/conflict state;
- source IDs referenced by provenance exist;
- presentation section overrides reference real sections;
- template/style IDs and schema compatibility ranges are compatible;
- selected presentation references an existing CV and template/version;
- template tokens, when used, are permitted by the manifest;
- A4 portrait resolves to exactly 210 x 297 mm;
- `isCurrent=true` has no end date;
- `targetPages <= maxPages`;
- page margins fit inside the page;
- every externally applied change set uses the current base revision.

## Extension policy

Core objects are strict. Extensibility is explicit:

- `extensions` maps use namespaced keys;
- custom CV entities use namespaced registries;
- template-specific presentation values live under `tokens.template` / `templateOverrides`;
- new core fields require a schema version change.

Unknown namespaced extensions must survive read/write/migration cycles even when the current Seevee version does not understand their payload.

## Compatibility

Resource families version independently. A comments schema upgrade does not require changing CV schema versions unless their shared contract actually changed.

Deterministic migrations are required for supported version transitions. Never use an LLM as the only migration mechanism for canonical state.
