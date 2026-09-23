# Seevee comments and targeting

## Principle

A comment is a review thread, not CV data. It carries one or more target selectors so it can remain useful after content edits, reorderings, repagination and template changes.

## Target model

A target has a semantic source and ordered selectors. Prefer the most stable selector first.

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
  "source": { "resource": "cv", "resourceId": "cv_...", "revision": 14 },
  "selectors": [
    { "type": "FieldSelector", "nodeId": "bul_...", "field": "/text" },
    { "type": "TextQuoteSelector", "exact": "Built an API...", "prefix": "", "suffix": "" },
    { "type": "PageRegionSelector", "page": 1, "x": 0.12, "y": 0.41, "width": 0.55, "height": 0.04 }
  ]
}
```

The page-region coordinates are normalized 0..1 relative to the physical page and are not authoritative semantic identity.

## Resolution order

For a semantic comment:

1. exact node/field target;
2. section/render binding target;
3. text quote fallback within the expected scope;
4. page region as a user-facing visual clue.

If multiple fallback candidates are equally plausible, mark the target ambiguous. Do not guess.

If the node was deleted intentionally, mark the target orphaned and preserve the thread/history.

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

Recommended thread states:

- `open`: awaiting work;
- `in_progress`: claimed by an agent/user;
- `applied`: a change was made and awaits review;
- `resolved`: accepted/closed;
- `reopened`: previously resolved, active again;
- `blocked`: cannot proceed without input;
- `orphaned`: target no longer resolves.

Keep work state distinct from resolution state. An agent must not convert `applied` to `resolved` merely because its own validation passed unless workspace policy explicitly enables deterministic auto-resolution.

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
6. move thread to `applied` or `blocked`;
7. never destroy the original selector set.
