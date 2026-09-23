# @seevee/agent-runtime

Typed tool boundary and revision-checked executor for Seevee agents.

This package is the foundation the dashboard and CLI call into. It exposes
a typed tool registry, a revision-aware executor, and the first role entry
point (`executeIngestionRole`). It performs **no LLM calls** and implements
**no mutation tools** — mutation tool handlers throw
`Error('mutation tool requires review: <name>')` so callers know they
must wire them through a review/approval surface.

The runtime is governed by `.dev/specs/WORKSPACE_AGENT_RUNTIME_SPEC.md`.
Read it before extending the package.

## Public surface

```ts
import {
  // Executor
  defineTools,
  runTool,
  RevisionMismatchError,
  ToolNotFoundError,
  FactPolicyError,
  mutationToolError,
  // Ingestion role
  executeIngestionRole,
  // Read tools (all exported individually + as group tuples)
  workspaceGetTool,
  workspacePutTool,
  workspaceListTool,
  cvListTool,
  cvGetTool,
  cvCreateTool,
  cvDuplicateTool,
  cvProposeChangesTool,
  provenanceGetTool,
  provenanceAssertTool,
  presentationListTool,
  presentationGetTool,
  presentationCreateTool,
  presentationProposeChangesTool,
  commentsListTool,
  commentsGetTool,
  commentsSetWorkStateTool,
  sourcesListTool,
  sourcesReadExtractTool,
  templatesListTool,
  templatesReadManifestTool,
  templatesReadSourceTool,
  templatesCreateDraftTool,
  templatesPatchDraftFileTool,
  templatesValidateTool,
  templatesCompileTool,
  templatesActivateTool,
  historyListTool,
  renderPreviewTool,
  renderInspectLayoutTool,
  exportPdfTool,
  // Canonical registry
  allAgentTools,
} from '@seevee/agent-runtime';
```

## Run result envelope

`runTool` never throws for input, unknown-name, or revision-mismatch
conditions. Every failure is returned as a structured envelope:

```ts
type RunToolResult<TOutput> =
  | { ok: true; output: TOutput; runId: string }
  | { ok: false; code: string; error: string };
```

The exported `ToolNotFoundError`, `RevisionMismatchError`, and
`FactPolicyError` classes carry matching `code` properties so callers can
do `instanceof` checks when they prefer an exception flow.

## Revision protocol

Tools that read revision-bearing resources (`workspace.get`, `cv.get`)
declare `requiresBaseRevision: true` on the definition. `runTool` compares
the caller-supplied `baseRevision` against the resource's current revision
and returns `{ ok: false, code: 'revision-mismatch' }` when they differ.
This is the §4 revision protocol enforcement layer; the dashboard and CLI
pass `baseRevision` from their in-memory cache so a concurrent write
cannot be silently overwritten.

## Blocked-not-guessed

When the ingestion role cannot resolve its inputs (unknown CV, missing
source blocks, semantic validation failures, …) it returns
`{ runRecord, blockedReason }` rather than fabricating facts. The runtime
never invents dates, employers, education, technologies, metrics, awards,
languages, URLs, or contact details (§5 fact policy).

## Persistence

Every ingestion run is persisted at:

```
<workspaceRoot>/.seevee/history/<runId>.json
```

The persisted document is schema-valid against
`agentRunDocumentSchema` from `@seevee/schema`.

## Scripts

```sh
pnpm --filter @seevee/agent-runtime typecheck
pnpm --filter @seevee/agent-runtime test
```
