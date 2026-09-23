# Development standards

## Current phase

Seevee is pre-1.0 and architecture-first. Check `.dev/IMPLEMENTATION_STATUS.md` before starting work.

Do not infer implementation from documentation.

## Target repository shape

The production implementation should become a pnpm TypeScript monorepo:

~~~text
apps/
  studio/
packages/
  schema/
  cli/
  renderer/
  export/
  ingest/
  agent-runtime/
  template-sdk/
  template-compiler/
templates/
skills/
schemas/
examples/
.dev/
~~~

This shape may evolve through reviewed changes, but do not create ad-hoc top-level application directories without updating the architecture.

## Development principles

- Prefer explicit typed contracts over implicit conventions.
- Keep canonical CV data independent from presentation/template source.
- Keep workspace runtime state out of canonical documents.
- Keep user-facing workspace-agent instructions separate from repository-maintainer instructions.
- Keep deterministic validation outside LLM behavior where possible.
- Treat generated code and imported sources as untrusted.
- Do not hide render failures with CSS clipping or silent fallback.
- Preserve forward migration paths for public schemas.
- Prefer small, composable packages over cross-cutting application globals.

## TypeScript

When implementation begins:

- enable strict TypeScript;
- no implicit `any`;
- avoid type assertions unless boundary validation justifies them;
- validate all external/untrusted input at runtime;
- derive public TS types from canonical Zod schemas;
- no duplicate hand-maintained public interfaces;
- use ESM consistently unless a platform constraint requires otherwise.

## Filesystem and persistence

- canonical JSON writes must be atomic;
- revision-checked writes must reject stale base revisions;
- runtime/caches belong under `.seevee/` or platform cache locations;
- never follow workspace paths outside the workspace root without explicit safe resolution;
- do not trust PID files without process identity/health verification.

## APIs and events

- typed internal APIs;
- version public contracts deliberately;
- use stable event names;
- events communicate committed state, never half-written intermediate JSON;
- errors have stable machine-readable codes plus useful human messages.

## UI development

- dashboard UI is fixed product chrome;
- CV template CSS must be isolated from dashboard CSS;
- accessibility is part of acceptance, not a later theme pass;
- do not turn the dashboard into a generic visual page builder;
- template-exposed controls are optional;
- CV source templates remain fully designable by users/agents.

## Security

Required from first implementation:

- loopback-only local server by default;
- strict workspace path boundaries;
- SSRF protection for remote ingestion;
- template import allowlist;
- no template access to process/env/filesystem/arbitrary network;
- isolated template compilation;
- origin/CORS protections;
- no secrets in workspace documents;
- upload limits.

## Dependencies

Add a dependency only when it materially reduces complexity or risk.

For each major dependency:

- confirm current maintenance;
- prefer official/widely used packages;
- pin/lock through the workspace lockfile;
- avoid duplicate libraries for the same concern;
- do not add runtime dependencies merely for trivial helpers.

## Testing

Every feature should add tests at the narrowest useful layer.

Required categories as implementation grows:

- unit;
- schema;
- semantic-reference;
- migration;
- ingestion fixture;
- CLI lifecycle;
- renderer/layout;
- template security;
- PDF/export;
- end-to-end;
- platform install/release.

Bug fixes should include a regression test when practical.

## Documentation

Any change to a public/resource contract must update:

- affected schema/source;
- migrations;
- fixtures;
- relevant `.dev/specs/`;
- workspace-agent docs if runtime behavior exposed to agents changed;
- CHANGELOG when user-visible.

Do not add new maintainer documents outside `.dev/`.
