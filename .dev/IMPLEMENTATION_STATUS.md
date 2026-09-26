# Implementation status

Audience: repository development agents.

Last audited: 2026-09-26

## Status legend

- **Implemented** — production code exists and its relevant package checks pass; this does not imply every integration path is complete.
- **Bootstrap** — partial non-production implementation exists.
- **Not implemented** — no production code exists yet.

## Current repository reality

Seevee has usable schema, CLI, ingestion, agent tools, local dashboard, and central multi-agent control implementations. Template-driven rendering and server-side PDF export remain incomplete. The dashboard supports browser print-to-PDF, a resizable right agent chat, and the left document editor with social links. Agent prompts receive the active CV, source excerpts, and a text/layout snapshot of the current editor preview; that snapshot is not a pixel screenshot.

All packages typecheck (`pnpm typecheck` exit 0). All tests pass (`pnpm test` exit 0). End-to-end smoke verified: `seevee init --no-open → seevee status → seevee stop`.

## Capability matrix

| Area | Status | Evidence |
|---|---|---|
| Canonical data contracts (P0) | Implemented | 37 tests pass; drift-check clean; `pnpm typecheck` exit 0 |
| `packages/schema` | Implemented | 12 Zod resource schemas + migrations + semantic validator + JSON Schema generator |
| `packages/cli` | Implemented | All commands (init/start/stop/restart/status/open/validate/doctor/export); workspace daemon lock prevents duplicate concurrent starts; 20 tests |
| `packages/agent-runtime` | Implemented | Typed workspace tools plus central process/session manager and Claude Code, Codex App Server, and OMP ACP adapters; 39 tests |
| `packages/ingest` | Implemented | 9 adapters (text/markdown/json/html/yaml/pdf/docx/image/url); SSRF protection; 57 tests |
| `apps/studio` | Implemented | Astro/React dashboard, revision-aware CV APIs, SSE agent timeline, Settings-driven provider/session configuration, resizable right agent sidebar, restored left document editor, and 14 tests |
| `install.sh` / `install.ps1` | Implemented | HTTPS-only downloads, SHA256SUMS, archive-path validation, atomic rollback, install locking, stale-version cleanup, and CI contract tests |
| `packages/template-sdk` | Implemented | 36 tests |
| `packages/renderer` | Implemented | 44 tests |
| `packages/export` | Partial | Export pipeline package and 12 tests; Playwright integration has not been verified against a real browser/runtime |
| `packages/template-compiler` | Partial | Policy scanning and compilation checks; fixture renderer uses a deterministic stub |
| `templates/classic/v1` | Implemented | Astro template + fixtures |
| `templates/two-column/v1` | Implemented | Astro template + fixtures |
| Release bundle scripts | Implemented | Five platform archives, lockfile-pinned production dependencies without optional native binaries, checksums, GitHub release workflow, and extracted-archive lifecycle smoke checks |

## Incomplete end-to-end paths

- Studio preview displays editable CV content but does not yet use the template renderer package.
- The Studio server-side PDF API returns HTTP 501; users can export the current editor preview through the browser's print-to-PDF dialog.
- Provider adapters have fixture/unit coverage and live no-model process handshakes, but automated model-backed tool/approval turns are intentionally not run in CI because they require provider credentials and usage.
- Image ingestion records a placeholder block; it does not perform vision extraction.
- CLI export integration and Playwright-backed PDF export have not been validated end to end.
- Every release archive is now structurally verified in CI; the Linux bundle is exercised through init/health/concurrent-start/stop, while Windows/macOS native process behavior still requires platform-specific runners.

## Key decisions (do not undo)

- `defineTools` / `runTool` use `ToolDefinition<any, any>` constraint for bivariance — `any` is sound here because the executor only calls `.safeParse` and invokes the handler.
- `runTool` catches non-mutation handler throws and returns `{ok: false, code: 'handler-error'}` — mutation tools re-throw so callers can use `.rejects.toThrow()`.
- CLI detached spawn uses `node` direct + `cwd: packages/cli/` + `NODE_OPTIONS: --import tsx` — `tsx` resolves relative to cwd.
- `pnpm-workspace.yaml` uses `['apps/*', 'packages/*']` — `templates/` is NOT in the workspace (it is source, not a package).
- `RoleDeps.toolRegistry` typed as `ToolRegistry<Record<string, ToolDefinition<any, any>>>` to allow any concrete tool type.

## Known pre-existing issues (non-blocking)

- `roles.test.ts` test fixture seeded by `tools.test.ts` shares module state via `allAgentTools` — tests pass in isolation; 2 tests in combined suite pass due to shared module initialization order.
- Studio dev server is Astro (Vite) — requires `pnpm install` + `pnpm --filter @seevee/studio run dev` for browser UI.
