# @seevee/studio

The local self-hosted Seevee Studio. Astro application that owns the
dashboard UI, the `/api/*` HTTP surface, and the SSE event bus for a
workspace.

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
| `/api/export/pdf`          | POST   | Generate PDF (stub → 501)                |
| `/api/agent/run`           | POST   | Trigger agent run (stub)                 |

## Constraints

- TypeScript strict, ESM, no `: any`.
- Schemas live in `@seevee/schema`; the Studio never accepts an
  unvalidated workspace file.
- The renderer, export, and agent-run paths are stubs. They exist so the
  dashboard end-to-end flow can be exercised; the real implementations
  land in `packages/renderer`, `packages/export`, and
  `packages/agent-runtime`.