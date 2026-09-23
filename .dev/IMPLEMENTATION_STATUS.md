# Implementation status

Audience: repository development agents.

Last audited: 2026-09-23

## Status legend

- **Specified** — architecture/contract exists, production implementation does not.
- **Bootstrap** — partial non-production implementation exists.
- **Not implemented** — no production code exists yet.
- **Blocked** — depends on an earlier implementation milestone.

## Current repository reality

Seevee is still in the architecture/design phase.

The repository currently contains:

- public README and branding;
- Draft 2020-12 bootstrap schemas;
- architecture/development specifications;
- one linked multi-CV workspace fixture;
- the end-user workspace-agent skill;
- a Unix GitHub Release installer shell;
- no production monorepo/runtime/dashboard/CLI server yet.

Do not claim a feature is implemented merely because its contract is documented.

## Capability matrix

| Area | Status | What exists | What still needs implementation |
|---|---|---|---|
| Canonical data contracts | Bootstrap | `schemas/v1/*.schema.json` | Zod source modules, generated schemas, runtime parsing, semantic validation |
| Multi-CV workspace index | Bootstrap | schema + example | workspace library service, CRUD, migration, file locking |
| Provenance | Specified | schema + docs + fixture | resolver, source linkage, conflict handling, UI |
| Comments | Specified | schema + docs + fixture | target resolver, overlay, thread UI, mutation linkage |
| Change sets | Specified | schema | domain operation executor, optimistic concurrency, history |
| Source ingestion | Not implemented | source schema + plan | text/MD/JSON/PDF/DOCX/HTML adapters, extraction pipeline |
| Workspace-agent runtime | Specified | skill + runtime spec | typed runtime API/tool layer, agent-run tracking |
| CLI | Not implemented | command contract only | executable/runtime, init/start/stop/restart/status/open/validate/doctor/export |
| GitHub installer | Bootstrap | `install.sh` | actual release bundles, release workflow, install integration tests, Windows installer |
| Local server | Not implemented | architecture only | Astro/Node server, health endpoint, detached lifecycle |
| File watching | Not implemented | behavior specified | stable-write detection, last-known-good state, SSE events |
| Dashboard shell | Not implemented | behavior + visual spec | React/Astro implementation and accessibility |
| CV page renderer | Not implemented | page model specified | physical-page renderer, bindings, measurement |
| Template SDK | Not implemented | contract specified | package, helpers, binding API |
| Template compiler/sandbox | Not implemented | policy specified | worker isolation, source policy, artifact build/activation |
| Built-in templates | Not implemented | examples only in plan | reusable starter templates |
| Style presets | Specified | schema | storage, dashboard actions, compatibility behavior |
| Render diagnostics | Specified | schema | DOM measurement, clipping/overflow/font/asset diagnostics |
| PDF export | Not implemented | workflow specified | Playwright renderer, Chromium provisioning, verification |
| Undo/history | Not implemented | change-set concept | persistent history and inverse changes |
| Tests | Minimal fixture only | one linked workspace example | unit/schema/migration/integration/e2e/visual/platform tests |
| CI | Not implemented | none | lint/typecheck/test/schema-generation/release workflows |
| Release automation | Not implemented | installer contract | platform builds, checksums, GitHub Releases |
| Security hardening | Specified | threat boundaries in docs | sandbox enforcement, SSRF protection, origin/auth controls |
| Windows support | Not implemented | planned | release artifact, install.ps1, process lifecycle tests |
| macOS support | Not implemented | planned | release artifact and process lifecycle tests |
| Linux support | Not implemented | planned | release artifact and process lifecycle tests |

## Required implementation order

### P0 — repository/runtime foundation

1. Create pnpm workspace and TypeScript project structure.
2. Add formatting, linting, typecheck, Vitest, Playwright, and CI.
3. Implement `packages/schema` in Zod.
4. Generate Draft 2020-12 schema artifacts from Zod.
5. Add semantic cross-resource validator.
6. Add deterministic migration framework and fixture tests.
7. Make committed bootstrap schemas generated artifacts rather than hand-maintained sources.

Exit criteria:

- schemas generate reproducibly;
- linked fixture validates structurally and semantically;
- CI detects schema drift;
- nested JSON Pointer tests pass.

### P1 — CLI and workspace core

1. Implement the actual `seevee` executable.
2. Implement workspace discovery.
3. Implement `seevee init` using the multi-CV directory model.
4. Generate **workspace-agent** instructions during init; never copy repository `.dev/AGENTS.md`.
5. Implement atomic JSON writes and revision checks.
6. Implement start/stop/restart/status/open/validate/doctor.
7. Implement detached server lifecycle and health endpoint.
8. Add stale PID/process identity protection.
9. Add integration tests for non-interactive init.

Exit criteria:

- `seevee init` returns terminal control;
- a valid workspace is created;
- the server survives the invoking shell;
- `seevee validate --json` validates the fixture.

### P2 — dashboard and live workspace

1. Implement Astro Node application.
2. Implement fixed dashboard shell from the visual spec.
3. Implement CV library browser.
4. Implement presentation/template selectors.
5. Implement file watcher and last-known-good resource state.
6. Implement SSE event stream.
7. Implement comments panel and semantic selection overlay.
8. Implement diagnostics UI.

Exit criteria:

- external edits to valid CV JSON live-update the canvas;
- invalid writes are surfaced without replacing valid in-memory state;
- multiple CVs switch cleanly.

### P3 — renderer and export

1. Implement template SDK.
2. Implement first minimal reusable Astro template.
3. Implement physical-page renderer.
4. Implement semantic DOM bindings.
5. Implement layout diagnostics.
6. Implement Playwright PDF export.
7. Implement lazy Chromium provisioning.
8. Verify physical page geometry.

Exit criteria:

- preview and PDF use the same presentation dimensions;
- no clipping/overflow is silently hidden;
- A4 default and custom dimensions work.

### P4 — ingestion and provenance

1. Implement plain text/Markdown/JSON adapters.
2. Implement DOCX/PDF deterministic extraction.
3. Add HTML/URL fetch with SSRF controls.
4. Implement normalized source blocks and locators.
5. Implement provenance assertions/conflict model.
6. Add agent-facing typed ingestion mutations.

Exit criteria:

- a source can become a validated CV without unrestricted JSON rewrite;
- factual fields can be traced to source evidence.

### P5 — workspace-agent operations

1. Implement typed tool/API surface described in `WORKSPACE_AGENT_RUNTIME_SPEC.md`.
2. Implement comment target resolution.
3. Implement comment-to-change-set workflow.
4. Implement run records.
5. Implement user-owned template editing flow.
6. Implement template compilation/sandbox validation.

Exit criteria:

- an arbitrary external agent can work through files/CLI/API without being Seevee-specific;
- comments survive ordinary reorder/rewrite operations;
- unsafe generated template code cannot activate.

### P6 — release/distribution

1. Build Linux x64/arm64 runtime archives.
2. Build macOS x64/arm64 archives.
3. Build Windows x64 archive.
4. Publish `SHA256SUMS`.
5. Add `install.ps1`.
6. Add GitHub Actions release workflow.
7. Integration-test `install.sh` against actual release artifacts.
8. Add rollback/update flow.

Exit criteria:

- README install command succeeds on a clean supported machine;
- no npm/pnpm is required for end-user installation.

## Known design decisions that must remain

- Repository developer instructions and workspace-agent instructions are different products.
- Every CV is a separate complete JSON resource.
- A presentation binds one CV to one template/version.
- Templates may be fully bespoke; no Seevee house style is imposed on CVs.
- CV best-practice research is agent guidance, not hard product validation.
- A4 portrait is the default new presentation, not a universal CV requirement.
- Page-count preferences are optional.
- The dashboard is fixed product UI.
- The runtime is agent-agnostic.
- The public installer is GitHub-release based, not npm based.

## Deferred/non-MVP work

These should not block the first useful release:

- multi-user hosted collaboration;
- network-exposed dashboard mode;
- cloud persistence;
- global daemon for multiple workspaces;
- plugin marketplace;
- advanced accessibility remediation;
- digitally signed release artifacts beyond checksums;
- full standalone binary if bundled Node runtime is initially used;
- automatic job-description acquisition;
- proprietary ATS scoring.

## Development completion rule

A development agent must distinguish:

- documented behavior;
- schema bootstrap behavior;
- implemented/runtime-tested behavior.

Do not mark a feature complete until the production code and relevant tests exist.
