# Seevee data contract

## Purpose

Seevee uses several independently versioned canonical documents. Their separation is an invariant:

- `cv.json`: semantic CV content.
- `provenance.json`: source/evidence links for facts and generated claims.
- `presentation.json`: page, theme, layout and visibility configuration.
- `comments.json`: review threads and resilient targets.
- `workspace.json`: workspace-level configuration and active resource references.
- `agent-state.json`: non-canonical run/checkpoint information.

Each canonical document has `kind`, `schemaVersion`, `id`, `revision`, `createdAt`, and `updatedAt`.

## Stable node model

Any semantic object that can be independently edited, ordered, referenced, commented on, or cited must have a stable `id`.

Examples:

- section: `sec_...`
- experience: `exp_...`
- education: `edu_...`
- project: `prj_...`
- bullet: `bul_...`
- skill group: `skg_...`
- skill: `skl_...`
- link: `lnk_...`
- comment/thread: `cmt_...` / `thr_...`
- template/preset: `tpl_...` / `sty_...`

Use UUIDv7-compatible opaque IDs or another single project-wide sortable opaque-ID implementation. Prefixes are descriptive and must not carry business meaning.

IDs survive reorder, wording edits, template switches and page repagination. A deleted semantic node's ID is not reused.

## Canonical CV organization

Prefer a modular section registry instead of hard-coding every future section at the document root.

The document contains:

- `identity`: person/contact identity fields;
- `sections`: ordered lightweight section instances;
- `entities`: typed stores keyed by semantic type and ID;
- `metadata`: locale and document-level information.

A section instance declares `sectionType`, title/label, visibility, ordered `items` as node references, and optional section-specific configuration. Entity bodies live in typed stores.

This gives templates one ordered section stream while allowing new entity/section types to be added without rewriting every existing top-level structure.

## References

A semantic reference is explicit:

```json
{
  "kind": "node",
  "nodeId": "exp_01...",
  "nodeType": "experience"
}
```

A field reference adds an RFC 6901-style pointer relative to the semantic node:

```json
{
  "kind": "field",
  "nodeId": "exp_01...",
  "nodeType": "experience",
  "field": "/role/title"
}
```

Pointers identify fields, not entity identity. Never persist `/entities/experience/3/...` as the only reference.

## Value state

Unknown is not the same as absent and never becomes fabricated data. Optional fields may be omitted; explicit null is used only where the schema defines a meaningful unknown/not-applicable state.

Use partial date objects:

```json
{
  "precision": "month",
  "year": 2025,
  "month": 9
}
```

Do not store ambiguous date strings as canonical dates.

## Evidence and provenance

Provenance targets use the same semantic field references as comments.

Each provenance assertion includes:

- target;
- one or more source references;
- source locator;
- evidence kind: explicit, paraphrased, inferred, user-confirmed, generated;
- confidence where extraction uncertainty exists;
- optional supporting excerpt hash/text within product privacy limits.

A generated phrase can be marked generated without exposing chain-of-thought.

## Mutations

Routine agent changes should use ID-aware typed operations, e.g.:

- `node.add`
- `node.remove`
- `node.move`
- `field.set`
- `field.unset`
- `text.replace`
- `section.add`
- `section.move`
- `presentation.set`

Each change set includes:

- changeSetId;
- target document ID;
- `baseRevision`;
- ordered operations;
- actor/run ID;
- reason/comment IDs;
- timestamp.

Use RFC 6902 JSON Patch only at API/interoperability edges when useful. Positional array patches are too brittle to be the primary domain mutation language.

## Referential integrity

Validation has two layers:

1. JSON Schema/Zod structural validation.
2. Semantic validation across documents.

Semantic checks include:

- every section item reference resolves;
- no node appears where its type is incompatible;
- all provenance/comment targets reference known nodes or are explicitly orphaned;
- IDs are unique workspace-wide for their resource class;
- presentation section overrides reference valid section IDs;
- template/preset references resolve;
- active resources are schema-compatible.

## Versioning and migration

Use semver-like schema versions per document family, e.g. `1.2.0`.

- patch: clarification/constraints that do not change accepted shape;
- minor: backward-compatible additions;
- major: incompatible structural change.

Every supported transition is an explicit pure migration. Never ask an LLM to migrate canonical data without a deterministic migration step.
