# Agent Contract

Status: runtime behavior specification
Date: 2026-09-23

## 1. Purpose

Agents are constrained operators over Seevee's canonical resources. They do not receive authority to rewrite arbitrary files or bypass validation.

The application exposes typed tools. Every write is revision checked, validated and auditable. Agents must resolve which CV JSON document is active or explicitly target a CV ID; never assume a single root `cv.json`.

## 2. Roles

### Ingestion agent

Inputs:

- extracted source blocks;
- current CV;
- provenance;
- source metadata.

Outputs:

- candidate semantic nodes;
- conflict records;
- provenance assertions;
- proposed change set.

Must not:

- invent missing facts;
- edit presentation/template source;
- silently resolve conflicting dates/employers.

### CV editor agent

Inputs:

- requested fields/comments;
- canonical CV/provenance.

Outputs:

- wording/content change sets.

Must:

- preserve factual meaning;
- distinguish copy improvements from fact changes;
- require evidence/user confirmation for unsupported factual additions.

### Design agent

CV layout/styling is fully user/agent controlled. Seevee does not impose a visual house style. A design agent may create a reusable template or a completely bespoke Astro/CSS composition around one CV.

Inputs:

- CV read model;
- presentation;
- template manifest/source;
- render diagnostics;
- design request.

Outputs:

- presentation change set or source-template draft.

Must not:

- rewrite CV facts to make layout easier;
- modify dashboard shell.

### Comment-fix agent

Inputs:

- comments;
- current resource revisions;
- target resolver;
- CV/presentation/template access.

Behavior:

1. resolve target;
2. classify request;
3. choose narrowest mutation surface;
4. apply change;
5. validate;
6. link change set;
7. mark applied or blocked.

### QA process

Prefer deterministic code over an LLM.

Checks:

- structural schemas;
- semantic references;
- migrations;
- template policy;
- build;
- render;
- page diagnostics;
- PDF geometry;
- unresolved blockers.

## 3. Typed tool boundary

Recommended tools:

~~~text
workspace.get
cv.list
cv.get
cv.create
cv.duplicate
cv.proposeChanges
provenance.get
presentation.list
presentation.get
presentation.create
presentation.proposeChanges
comments.list
comments.get
comments.setWorkState
sources.list
sources.readExtract
templates.list
templates.readManifest
templates.readSource
templates.createDraft
templates.patchDraftFile
templates.validate
templates.compile
templates.activate
render.preview
render.inspectLayout
export.pdf
history.list
~~~

Agents never directly write canonical JSON files through a generic filesystem tool in hosted mode.

## 4. Revision protocol

For any mutation:

1. read resource;
2. capture revision;
3. resolve target IDs;
4. construct typed change set;
5. submit with baseRevision;
6. if stale, reload and rebase;
7. run semantic validation;
8. commit;
9. rerender when relevant.

## 5. Fact policy

The agent may:

- paraphrase an existing supported fact;
- condense multiple supported facts;
- omit less relevant facts;
- reorganize supported content.

The agent may not fabricate:

- dates;
- employers;
- education;
- certifications;
- technologies;
- responsibilities;
- metrics;
- awards;
- languages;
- URLs;
- contact details.

A generated professional summary is allowed if its factual claims are grounded in the CV/provenance graph.

## 6. Comment classification

Classify each thread:

- fact -> CV + provenance;
- copy -> CV wording;
- style -> presentation tokens;
- layout -> presentation or template source;
- template -> template source;
- page -> page/pagination presentation;
- accessibility -> template/presentation;
- general -> inspect and decide.

If the target is ambiguous, block rather than guessing.

## 7. Template source behavior

Before source work, read:

- current template manifest;
- template SDK contract;
- diagnostics;
- representative fixture requirements.

After source work:

1. static policy validation;
2. Astro/type check;
3. fixture renders;
4. A4 diagnostics;
5. PDF test;
6. compile artifact;
7. activate only on success.

## 8. Local provider control

Studio owns a central process/session manager. Provider-specific modules translate their native structured protocols into the shared agent event and capability contract:

- Claude Code: official Agent SDK using the installed local executable;
- Codex: App Server JSON-RPC over stdio;
- OMP: Agent Client Protocol over stdio.

The browser selects only registered provider IDs. It cannot supply an executable, arguments, environment, or working directory. Provider processes use fixed argument arrays and `shell: false`.

The right chat renders the active provider-neutral timeline, native model and
permission controls, and approval requests. The left sidebar remains the
direct document editor and comments surface. The browser selects only
provider IDs and provider-returned option IDs; executable paths, command
arguments, environment, and working directories remain server-owned.

Every adapter injects the canonical
`packages/agent-runtime/src/control/seevee-agent.md` instructions through its
native system/developer-instruction mechanism. Provider-visible reasoning may
stream live but is not persisted. Tool and approval payloads are bounded and
secret-like fields are redacted. After a turn finishes, Seevee validates
changed workspace resources and records deterministic check results.

## 9. Agent run record

Persist:

- run ID;
- role/type;
- input revisions;
- requested comment IDs;
- tool/action summary;
- change-set IDs;
- deterministic check results;
- concise outcome;
- timestamps.

Do not persist private reasoning traces.

## 10. Completion

An agent must not claim success when:

- target became stale and was not rebased;
- schema validation failed;
- semantic references are broken;
- template compilation failed;
- requested content requires unknown facts;
- A4 layout clips content;
- export is relevant and PDF verification failed.

Return a precise blocked reason instead.
