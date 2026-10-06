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
| Canonical data contracts (P0) | Implemented | 47 tests pass; drift-check clean; `pnpm typecheck` exit 0 |
| `packages/schema` | Implemented | 12 Zod resource schemas + migrations + semantic validator + JSON Schema generator |
| `packages/cli` | Implemented | All commands including real PDF export; workspace daemon lock prevents duplicate concurrent starts; 33 tests |
| `packages/agent-runtime` | Implemented | Typed workspace tools plus central process/session manager and Claude Code, Codex App Server, and OMP ACP adapters; 44 tests |
| `packages/ingest` | Implemented | 8 extraction adapters (text/markdown/json/html/yaml/pdf/docx/url) plus SSRF protection; the image adapter rejects with a typed error instead of returning a placeholder; 59 tests |
| `apps/studio` | Implemented | Astro/React dashboard, revision-aware CV APIs, SSE agent timeline, Settings-driven provider/session configuration, real template preview, real PDF export endpoint, and 61 tests |
| `install.sh` / `install.ps1` | Implemented | HTTPS-only downloads, SHA256SUMS, archive-path validation, atomic rollback, install locking, stale-version cleanup, and CI contract tests |
| `packages/template-sdk` | Implemented | Real Astro `Page`/`Section`/`Item`/`Field` components with value-resolving `Field`; 47 tests |
| `packages/template-render` | Implemented | Executes a template's Astro entry through Astro's container with a cached Vite server per root; scoped-CSS collection; 42 tests |
| `packages/renderer` | Implemented | 44 tests |
| `packages/export` | Implemented | Renders the real template, captures with Chromium, verifies physical page size and the presentation's page policy, writes metadata; 17 tests. Verified end to end against a real Chromium producing an A4 PDF |
| `packages/template-compiler` | Implemented | Policy scanning, compilation checks, and real Chromium layout measurement of rendered fixtures; 28 tests |
| `templates/classic/v1` | Implemented | Astro template, executed by the renderer and verified in a real export |
| `templates/two-column/v1` | Implemented | Astro template + fixtures, executed by the renderer |
| Release bundle scripts | Implemented | Five platform archives, dependency-derived package list, checksums, GitHub release workflow, and extracted-archive lifecycle smoke checks |

## Incomplete end-to-end paths

- No automated page-fit check exists. Layout is measured during template compilation and export, but there is no per-keystroke overflow indicator in the editor, and no check that content actually fits the presentation's declared page budget at edit time.
- Provider adapters have fixture/unit coverage and live no-model process handshakes, but automated model-backed tool/approval turns are intentionally not run in CI because they require provider credentials and usage.
- Vision extraction is not implemented. Image sources are rejected with an explicit typed error rather than silently producing an empty document.
- Export requires a Chromium binary, which the first export downloads (~150MB) rather than shipping in the ~52MB bundles. A fully offline first run is not possible without bundling the browser.
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
