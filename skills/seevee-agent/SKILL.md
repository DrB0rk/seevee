---
name: seevee-agent
description: Operate and modify Seevee agent-driven CV workspaces safely and consistently. Use when an agent needs to ingest or normalize CV information, edit canonical CV content, apply review comments, adjust presentation/page settings, create or modify Astro CV templates, save style presets, render or export a CV, or validate a Seevee workspace. Enforces Seevee's stable-node/reference model, provenance rules, revision-safe mutations, A4-first page model, template sandbox boundaries, and completion checks.
---

# Seevee Agent

Use Seevee's structured documents as the source of truth. Do not treat rendered HTML or PDF output as canonical data.

## Start here

1. Identify the requested operation: ingest, content edit, comment fix, presentation edit, template work, export, or QA.
2. Read the minimum relevant references:
   - CV facts, IDs, references, provenance, or mutation semantics: `references/data-contract.md`.
   - Comments, anchors, resolution, or comment-driven fixes: `references/comments.md`.
   - Astro templates, visual design, page sizing, or style presets: `references/templates-and-rendering.md`.
   - End-to-end agent procedure and completion rules: `references/workflows.md`.
   - Workspace initialization, CLI/server lifecycle, or working alongside arbitrary external agents: `references/cli-and-workspace.md`.
3. Read the workspace's current revisions before proposing a mutation.
4. Use the narrowest mutation surface. Do not replace a whole canonical document for a small edit.
5. Validate after every committed mutation category.

## Hard rules

- Never invent employers, dates, degrees, technologies, certifications, metrics, achievements, links, contact data, or other factual claims.
- Distinguish extracted/user facts from generated wording. Preserve provenance for factual and numerical claims.
- Never identify an entity only by array index. Use stable node IDs.
- Never use a JSON Pointer as the sole long-lived identity for a list item. Pair field pointers with a stable node target.
- Keep CV content, presentation, template source, provenance, and comments separate.
- Treat unresolved factual conflicts as conflicts. Do not silently choose one value.
- Treat generated Astro template code as restricted visual code. Do not add filesystem, process, environment, arbitrary network, dynamic-evaluation, endpoint, or package-install capabilities.
- The dashboard/editor is fixed product UI. Do not redesign it when asked to redesign a CV.
- Default document profile is A4 portrait, 210 mm x 297 mm.
- Preview and PDF export must share the same page dimensions and render contract.
- Do not mark a comment resolved merely because an agent attempted a fix. Mark it applied/pending review until a user or deterministic rule resolves it.
- Do not store private chain-of-thought. Store only concise run summaries, evidence, diagnostics, and decisions needed by the product.

## Mutation discipline

For each change:

1. Read the target document and its `revision`.
2. Resolve semantic targets by stable IDs and selectors.
3. Propose typed operations with `baseRevision`.
4. Revalidate the entire affected document after applying the operations.
5. Reject the write if the canonical revision changed in the meantime; reread and rebase instead.
6. Record a concise change-set/run entry.

Use RFC 6901-style field pointers where a field path is useful, but prefer Seevee's ID-aware mutation operations for arrays and entities. Do not depend on positional JSON Patch paths such as `/experience/2` as persistent references.

## Content work

When editing copy:

- preserve factual meaning;
- write generated summaries/bullets only from known facts;
- keep wording changes separate from factual corrections;
- require source or user confirmation for new numeric impact claims;
- preserve stable IDs when reordering or rewriting existing nodes;
- create a new ID only for a genuinely new semantic node.

## Comment-driven work

A comment can target content, a field, text, a section, template region, or rendered page region. Resolve the strongest selector first and use fallbacks only when necessary.

Before applying a comment, classify it as one of:

- factual correction;
- content/copy;
- presentation token;
- layout;
- template source;
- page/export;
- general/no-op.

Then mutate only the corresponding document or template surface. Read `references/comments.md` for anchor and state rules.

## Template work

For visual/template changes:

- keep `cv.json` read-only;
- use the template SDK bindings for every semantic/commentable rendered block;
- keep A4 and custom physical sizes page-aware;
- preserve print-safe typography and explicit overflow behavior;
- use presentation tokens for ordinary style changes;
- create/fork source templates only for structural or visual-system changes;
- run template validation, render diagnostics, and export checks before completion.

Read `references/templates-and-rendering.md` before generating or patching template source.

## Completion

A task is complete only when the affected schemas validate and relevant deterministic checks pass. For rendered/template work, also verify page count, clipping/overflow, assets/fonts, and PDF export readiness.

If the requested change cannot be made without inventing facts, breaking a schema invariant, or using forbidden template capabilities, report the blocker and the precise information or architectural change required.
