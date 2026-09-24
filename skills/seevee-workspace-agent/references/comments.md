# Seevee comments and targeting

## Principle

A comment is a review thread, not CV data. It carries one or more target selectors so it can remain useful after content edits, reorderings, repagination and template changes.

## Target model

A target has a semantic source and ordered selectors. Prefer the most stable selector first; a dashboard pin stores the semantic selector before its visual page-region fallback.

Supported selector concepts:

1. `NodeSelector` — stable semantic node ID.
2. `FieldSelector` — stable node ID plus field pointer.
3. `TextQuoteSelector` — exact text plus optional prefix/suffix fallback.
4. `SectionSelector` — stable section ID.
5. `RenderBindingSelector` — stable template binding/region ID.
6. `PageRegionSelector` — page ID/index plus normalized rectangle; visual fallback only.

Example:

```json
{
  "target": {
    "source": { "resource": "cv", "resourceId": "cv_...", "revisionAtCreation": 14 },
    "selectors": [
      { "type": "FieldSelector", "nodeId": "bul_...", "nodeType": "bullet", "field": "/text" },
      { "type": "TextQuoteSelector", "exact": "Built an API...", "prefix": "", "suffix": "" },
      { "type": "PageRegionSelector", "page": 1, "x": 0.12, "y": 0.41, "width": 0.015, "height": 0.015,
        "renderContext": { "cvRevision": 14, "presentationRevision": 3, "templateVersionId": "tplclassic0000000000000000001" } }
    ],
    "extensions": { "seevee.placement": {
      "page": 1, "x": 0.12, "y": 0.41, "element": "Result · Senior Engineer",
      "contextText": "Built an API...", "fieldPath": "experience.exp_acme.bullets.bul_acme.text"
    } }
  }
}
```

`PageRegionSelector.x` and `.y` are normalized coordinates on the page, measured from its top-left; they are a visual fallback and are not semantic identity. `renderContext` records which CV revision, presentation revision and template version were visible when the comment was placed. The `seevee.placement` extension is a human-readable snapshot: `element` names the clicked field/section/entity, while `contextText` contains up to 280 characters visible there. This snapshot may be stale after later CV edits; resolve the stable selector against the current CV and use the saved text only to help disambiguate. Older comments may not contain `contextText`.

## Read dashboard comments

1. Read `seevee.json` and identify the selected CV and its registered comments resource by matching `resources.comments[*].cvId`. Do not assume the comments document ID equals the CV ID.
2. Load that JSON sidecar and follow `data.threadOrder`; ignore IDs missing from `data.threads`.
3. Work only on actionable threads (`status` is `open` or `in_progress`). Read the latest message in `messageOrder`; messages with `supersedesMessageId` are edit history, not additional instructions to stack together.
4. Read `target.source` and compare `revisionAtCreation` with the current CV revision. Then resolve `FieldSelector`, `NodeSelector`, or `SectionSelector` by stable IDs. A semantic selector takes precedence over page coordinates.
5. Use `seevee.placement.element` and `contextText` to understand what the user saw. Use `PageRegionSelector.page/x/y` as the visual location when no semantic selector exists or as a layout clue. If the selector and saved visual context no longer agree, re-render and report the mismatch instead of guessing.
6. Treat the latest message body as the requested action. If it does not say what should change, ask for clarification instead of inventing intent. Classify it from its content because dashboard-created threads use category `general` and priority `normal`.

Dragging a dashboard pin updates its page coordinates, element label, context snapshot and semantic selector. A pin moved onto blank space has no semantic selector; its page point and visual snapshot remain available. Editing a message appends a superseding message, so always read the newest ordered message.

## Resolution order

For a semantic comment:

1. exact node/field target;
2. section/render binding target;
3. text quote fallback within the expected scope;
4. page region as a user-facing visual clue.

If multiple fallback candidates are equally plausible, report the target as ambiguous, keep its original selectors, and set `agentWork.state` to `blocked` when the workspace's supported mutation surface allows it. Do not guess.

If the node was deleted intentionally, do not point the comment at another node. Preserve its original target and set `agentWork.state` to `blocked` with a concise explanation of the missing target.

## Thread model

A thread contains:

- `id`;
- target;
- category;
- priority;
- status;
- messages;
- created/updated metadata;
- agent work state;
- linked change-set IDs;
- optional resolution metadata.

Messages are immutable append-only records. Editing a message should create a superseding message or a revision record rather than silently rewriting audit history.

## Status model

Allowed thread states:

- `open`: awaiting work;
- `in_progress`: work is active;
- `resolved`: accepted/closed;
- `dismissed`: intentionally not actionable;
- `superseded`: replaced by another thread.

Keep `agentWork.state` distinct from thread `status`. Work state may be `pending`, `claimed`, `running`, `applied`, `blocked`, or `failed`. Do not set thread status to undocumented values such as `applied`, `blocked`, `reopened`, or `orphaned`. An agent must not convert an applied thread to `resolved` merely because its own validation passed unless workspace policy explicitly enables deterministic auto-resolution.

## Categories

Use a controlled extensible category vocabulary:

- `fact`
- `copy`
- `style`
- `layout`
- `template`
- `page`
- `accessibility`
- `general`

Allow `custom:<namespace>:<value>` extensions without changing the core schema.

## Comment-driven changes

A change set created from a comment includes `reason.commentIds`.

When applying:

1. re-resolve the target against current revisions;
2. reclassify if necessary;
3. mutate the narrowest document;
4. validate;
5. attach the resulting change-set/run ID;
6. set `agentWork.state` to `applied` or `blocked`; keep thread `status` separate and preserve its allowed value;
7. never destroy the original selector set.
