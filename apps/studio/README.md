# @seevee/studio

The local self-hosted Seevee Studio. Astro application that owns the
dashboard UI, the `/api/*` HTTP surface, and the SSE event bus for a
workspace.

The right sidebar hosts one React/GSAP agent chat driven by the central
runtime in `@seevee/agent-runtime`. Agent selection, session start/resume,
provider-native model choices, and permission modes are available in both
the composer and Settings; the left sidebar remains the document editor and
comments surface.

## Scripts

```sh
pnpm dev      # astro dev against $SEEVEE_WORKSPACE_ROOT or $PWD
pnpm build    # standalone Node server at dist/server/entry.mjs
pnpm start    # node ./dist/server/entry.mjs
pnpm typecheck
pnpm test
```

## Workspace discovery

The Studio looks for a `seevee.json` marker at process start, in this
order:

1. `$SEEVEE_WORKSPACE_ROOT` if set.
2. `process.cwd()`.

The CLI's `start` flow spawns `astro dev` with the workspace root
forwarded through `SEEVEE_WORKSPACE_ROOT`.

## API surface

| Path                       | Method | Description                              |
| -------------------------- | ------ | ---------------------------------------- |
| `/api/health`              | GET    | Server + workspace identity              |
| `/api/cv`                  | GET    | List CV summaries                        |
| `/api/cv/:id`              | GET    | Single CV document                       |
| `/api/presentation`        | GET    | List presentations                       |
| `/api/presentation/:id`    | GET    | Single presentation                      |
| `/api/comments`            | GET    | List comment summaries                   |
| `/api/comments/:id`        | GET    | Single comments document                 |
| `/api/sources`             | GET    | List source summaries                    |
| `/api/events`              | GET    | SSE workspace-change stream              |
| `/api/render/preview`      | POST   | Re-render CV canvas (stub)               |
| `/api/render/inspect`      | GET    | Layout diagnostics                       |
| `/api/export/pdf`          | POST   | Server-side PDF pipeline (stub → 501); use the dashboard's browser print-to-PDF control |
| `/api/agents`                      | GET    | Local agent detection, live sessions, saved-session index |
| `/api/agents/session`              | POST   | Start or resume a provider session |
| `/api/agents/session/:id`          | PATCH  | Update model and permission mode |
| `/api/agents/session/:id/options`    | GET    | Discover the active session's provider-native model and permission options |
| `/api/agents/session/:id`          | DELETE | Close a provider session |
| `/api/agents/session/:id/prompt`   | POST   | Send or steer a prompt |
| `/api/agents/session/:id/interrupt`| POST   | Interrupt the active turn |
| `/api/agents/session/:id/approval` | POST   | Resolve a pending permission request |

## Constraints

- TypeScript strict, ESM, no `: any`.
- Schemas live in `@seevee/schema`; the Studio never accepts an
  unvalidated workspace file.

All agent mutations require a same-origin request and the
`X-Seevee-Agent: 1` marker. Provider commands run with fixed executable
arguments and `shell: false`; the browser never supplies a command or
working directory.

Each adapter receives the canonical `packages/agent-runtime/src/control/seevee-agent.md`
instructions through its native system/developer-instruction mechanism. The
runtime exposes only provider IDs, model IDs, and permission IDs to the
browser; it never accepts executable paths or command arguments from the UI.

- The renderer and export paths remain partial. Agent execution is
  implemented for Claude Code, Codex, and OMP in
  `packages/agent-runtime/src/adapters/`.
