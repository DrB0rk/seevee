# AGENTS.md

This file is the entry point for coding agents working on Seevee.

## Read before changing code

For any non-trivial change, read:

1. docs/SCHEMA_ARCHITECTURE.md
2. docs/DEVELOPMENT_PLAN.md

Then read the task-specific document:

- dashboard/editor: docs/DASHBOARD_EDITOR.md
- Astro template or rendering work: docs/TEMPLATE_AUTHORING.md
- agent behavior, ingestion, comments, mutations or validation: docs/AGENT_CONTRACT.md
- installer, CLI, workspace scaffold or local server lifecycle: docs/CLI_INSTALLER.md

If your environment supports reusable skills, use skills/seevee-agent/SKILL.md when operating a Seevee workspace or implementing behavior governed by the runtime contracts.

## Architectural invariants

- Treat schemas as public APIs.
- Do not create task-specific JSON shapes outside packages/schema.
- Canonical CV content, provenance, presentation, comments and template source remain separate resources.
- Every independently editable/commentable semantic object has a stable ID.
- Array positions are never long-lived identity.
- Comments use resilient selectors and can link to semantic content and rendered fallbacks.
- CV facts are never invented by an agent.
- Generated wording and factual evidence are distinguishable.
- The dashboard is fixed product UI. Agents design CV pages, not the dashboard.
- Default page profile is A4 portrait, 210 x 297 mm.
- Preview and PDF export use the same page model.
- Source-template changes are validated and compiled before activation.
- Ordinary styling should use presentation tokens/style presets, not source duplication.
- Writes are revision checked. Never silently overwrite a newer revision.
- Deterministic validation gates agent completion.
- The user-facing executable is `seevee`; `seevee init` is non-interactive and must return terminal control after a healthy detached dashboard server is running.
- Seevee must remain agent-agnostic: do not make the dashboard dependent on Claude Code, Codex, OMP, Cursor, or another specific agent runtime.

## Schema implementation rule

The runtime source of truth should be Zod schemas in packages/schema. Generate JSON Schema 2020-12 artifacts from those definitions. Do not manually maintain competing TypeScript types and JSON Schemas.

Structural validation is not sufficient. Add semantic validators for cross-document references, node-type compatibility, comment targeting, template compatibility and provenance integrity.

## Change discipline

Prefer small, reviewable changes. For schema changes:

1. update the canonical Zod module;
2. update migrations if required;
3. regenerate JSON Schema artifacts;
4. update fixtures;
5. update semantic validators;
6. run schema/migration tests;
7. update affected docs;
8. verify old supported workspaces still load or fail with a clear migration requirement.

For rendering changes, include dense and sparse CV fixtures and verify A4 export.

Do not mark work complete while known schema, overflow, clipping, migration or reference-integrity failures remain.
