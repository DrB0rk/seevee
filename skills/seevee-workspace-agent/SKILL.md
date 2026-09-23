---
name: seevee-workspace-agent
description: Operate inside an end-user Seevee CV workspace safely and consistently; this skill is not for developing the Seevee repository itself. Use when an agent needs to ingest or normalize CV information, edit or tailor CV content, apply review comments, adjust presentation/page settings, create or modify Astro CV templates, save style presets, render or export a CV, or validate a Seevee workspace. Enforces Seevee's stable-node/reference model, provenance rules, revision-safe mutations, A4-default page model, template sandbox boundaries, multi-CV resource model, and completion checks.
---

# Seevee Workspace Agent

Use this skill only for an end-user Seevee workspace. If you are modifying the Seevee application repository itself, stop and follow that repository's `.dev/AGENTS.md` instead.

Use Seevee's structured documents as the source of truth. Do not treat rendered HTML or PDF output as canonical data.

## Start here

1. Identify the requested operation: ingest, content edit, comment fix, presentation edit, template work, export, or QA.
2. Read the minimum relevant references:
   - CV facts, IDs, references, provenance, or mutation semantics: `references/data-contract.md`.
   - Comments, anchors, resolution, or comment-driven fixes: `references/comments.md`.
   - Astro templates, visual design, page sizing, or style presets: `references/templates-and-rendering.md`.
   - End-to-end agent procedure and completion rules: `references/workflows.md`.
   - Workspace initialization, CLI/server lifecycle, or working alongside arbitrary external agents: `references/cli-and-workspace.md`.
   - Drafting, tailoring, reviewing, or restructuring CV content: `references/cv-guidance.md`.
3. Read the workspace's current revisions before proposing a mutation.
4. Use the narrowest mutation surface. Do not replace a whole canonical document for a small edit.
5. Validate after every committed mutation category.

## Hard rules

- Never invent employers, dates, degrees, technologies, certifications, metrics, achievements, links, contact data, or other factual claims.
- Distinguish extracted/user facts from generated wording. Preserve provenance for factual and numerical claims.
- Never identify an entity only by array index. Use stable node IDs.
- Never use a JSON Pointer as the sole long-lived identity for a list item. Pair field pointers with a stable node target.
- Keep each CV as its own JSON resource. Keep CV content, presentation, template source, provenance, and comments separate.
- Treat unresolved factual conflicts as conflicts. Do not silently choose one value.
- Treat generated Astro template code as restricted visual code. Do not add filesystem, process, environment, arbitrary network, dynamic-evaluation, endpoint, or package-install capabilities.
- The dashboard/editor is fixed product UI. Do not redesign it when asked to redesign a CV.
- CV layout and styling are fully user/agent controlled inside the template safety boundary.
- Default new-presentation profile is A4 portrait, 210 mm x 297 mm; it is not a mandatory CV style or page size.
- Preview and PDF export must share the same selected page dimensions and render contract.
- Do not turn CV best practices into hidden dashboard rules, a profile selector, or a resume score.
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
- create a new ID only for a genuinely new semantic node;
- read `references/cv-guidance.md` when tailoring/reviewing a CV.

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

- keep the selected `cvs/<cv-id>.json` content resource read-only during visual-only template work;
- use the template SDK bindings for every semantic/commentable rendered block;
- keep selected physical page dimensions page-aware;
- preserve explicit overflow behavior;
- use presentation tokens when the template exposes them, but do not require them;
- allow fully bespoke Astro/CSS layouts when requested;
- create/fork source templates whenever source-level design control is the appropriate surface;
- run template validation, render diagnostics, and export checks before completion.

Read `references/templates-and-rendering.md` before generating or patching template source.

## Completion

A task is complete only when the affected schemas validate and relevant deterministic checks pass. For rendered/template work, also verify page count, clipping/overflow, assets/fonts, and PDF export readiness.

If the requested change cannot be made without inventing facts, breaking a schema invariant, or using forbidden template capabilities, report the blocker and the precise information or architectural change required.
