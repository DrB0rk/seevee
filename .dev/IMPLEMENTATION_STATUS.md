# Implementation status

Audience: repository development agents.

Last audited: 2026-09-23

## Status legend

- **Implemented** — production code exists and its relevant package checks pass; this does not imply every integration path is complete.
- **Bootstrap** — partial non-production implementation exists.
- **Not implemented** — no production code exists yet.

## Current repository reality

Seevee has substantial implementations across schema, CLI, ingestion, agent tools, Studio, template, and packaging areas. Several end-to-end paths remain placeholders, so the project is not release-ready.

All packages typecheck (`pnpm typecheck` exit 0). All tests pass (`pnpm test` exit 0). End-to-end smoke verified: `seevee init --no-open → seevee status → seevee stop`.

## Capability matrix

| Area | Status | Evidence |
|---|---|---|
| Canonical data contracts (P0) | Implemented | 37 tests pass; drift-check clean; `pnpm typecheck` exit 0 |
| `packages/schema` | Implemented | 12 Zod resource schemas + migrations + semantic validator + JSON Schema generator |
| `packages/cli` | Implemented | All commands (init/start/stop/restart/status/open/validate/doctor/export); 18 tests |
| `packages/agent-runtime` | Implemented | Typed tool boundary; 35 tests |
| `packages/ingest` | Implemented | 9 adapters (text/markdown/json/html/yaml/pdf/docx/image/url); SSRF protection; 57 tests |
| `apps/studio` | Implemented | Astro dashboard + 11 API routes + watcher + renderer + workspace lib; 8 tests |
| `install.sh` / `install.ps1` | Implemented | SHA256SUMS; 12+5 tests |
| `packages/template-sdk` | Implemented | 36 tests |
| `packages/renderer` | Implemented | 44 tests |
| `packages/export` | Partial | Export pipeline package and 12 tests; Playwright integration has not been verified against a real browser/runtime |
| `packages/template-compiler` | Partial | Policy scanning and compilation checks; fixture renderer uses a deterministic stub |
| `templates/classic/v1` | Implemented | Astro template + fixtures |
| `templates/two-column/v1` | Implemented | Astro template + fixtures |
| Release bundle scripts | Partial | Scripts and workflow exist; bundle versions disagree with root `VERSION`, and Windows launcher is not a native executable |

## Incomplete end-to-end paths

- Studio preview rendering returns an empty placeholder page; it does not use the renderer package.
- Studio PDF export returns HTTP 501.
- Studio agent-run API only emits a started event and does not execute an agent.
- Image ingestion records a placeholder block; it does not perform vision extraction.
- CLI export integration and Playwright-backed PDF export have not been validated end to end.
- Release bundles have not been proven installable on their target operating systems. The current bundle script writes the root `package.json` version (`0.1.0`) while the canonical `VERSION` is `0.1.0-alpha.0`; the Windows `bin/seevee.exe` is copied from JavaScript and is not a PE executable.

## Key decisions (do not undo)

- `defineTools` / `runTool` use `ToolDefinition<any, any>` constraint for bivariance — `any` is sound here because the executor only calls `.safeParse` and invokes the handler.
- `runTool` catches non-mutation handler throws and returns `{ok: false, code: 'handler-error'}` — mutation tools re-throw so callers can use `.rejects.toThrow()`.
- CLI detached spawn uses `node` direct + `cwd: packages/cli/` + `NODE_OPTIONS: --import tsx` — `tsx` resolves relative to cwd.
- `pnpm-workspace.yaml` uses `['apps/*', 'packages/*']` — `templates/` is NOT in the workspace (it is source, not a package).
- `RoleDeps.toolRegistry` typed as `ToolRegistry<Record<string, ToolDefinition<any, any>>>` to allow any concrete tool type.

## Known pre-existing issues (non-blocking)

- `roles.test.ts` test fixture seeded by `tools.test.ts` shares module state via `allAgentTools` — tests pass in isolation; 2 tests in combined suite pass due to shared module initialization order.
- Studio dev server is Astro (Vite) — requires `pnpm install` + `pnpm --filter @seevee/studio run dev` for browser UI.
