# Seevee data contract

## Purpose

Seevee uses several independently versioned canonical documents. Their separation is an invariant:

- `cvs/<cv-id>.json`: one complete semantic CV document per file.
- `provenance/<cv-id>.json`: source/evidence links associated with a CV.
- `presentations/<presentation-id>.json`: page/layout/template state that explicitly references one CV ID.
- `comments/<cv-id>.json`: review threads associated with a CV.
- `seevee.json`: workspace library/index and active CV/presentation references.
- `.seevee/*`: non-canonical runtime/checkpoint information.

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

Each tailored CV is a separate complete JSON document. Within each CV, prefer a modular section registry instead of hard-coding every future section at the document root.

The document contains:

- `identity`: person/contact identity fields;
- `sections`: ordered lightweight section instances;
- `entities`: typed stores keyed by semantic type and ID;
- `metadata`: locale and document-level information.

A section instance declares `sectionType`, title/label, visibility, ordered `items` as node references, and optional section-specific configuration. Entity bodies live in typed stores.

This gives templates one ordered section stream while allowing new entity/section types to be added without rewriting every existing top-level structure.

### Custom sections and entries

Use the canonical CV schema's `type: "custom"` sections for content that does not fit profile, experience, education, projects, or skills. Add section IDs to `sectionOrder`; each custom section's `nodeOrder` lists IDs from `entities.custom` in display order. A custom entity has a stable ID, a short `label`, and a `data` object whose keys describe its fields:

```json
{
  "sectionOrder": ["sec_custom_languages"],
  "sections": {
    "sec_custom_languages": {
      "id": "sec_custom_languages",
      "type": "custom",
      "title": "Languages",
      "visible": true,
      "nodeOrder": ["custom_language_dutch"]
    }
  },
  "entities": {
    "custom": {
      "custom_language_dutch": {
        "id": "custom_language_dutch",
        "type": "customEntity",
        "label": "Dutch",
        "data": { "proficiency": "Native" }
      }
    }
  }
}
```

Create sections and entries in the dashboard when the user wants to author content directly. Agents can create the same structures in CV JSON and should use meaningful field names and readable values. Dashboard editing supports scalar fields; preserve any nested objects or arrays an agent adds. Render custom sections with the selected CV's layout and styling, and bind fields to stable item IDs and JSON Pointer paths such as `/data/proficiency` so comments and edits stay attached to the right content. Keep section and entry IDs stable when changing wording or order.

Do not put template source or a mandatory template selection inside CV JSON. A presentation binds a CV to a template/version. Many presentations may reference the same CV and many CVs may use the same template.

Before changing a CV or resolving comments, read `seevee.json`'s `data.policy`. The dashboard's Agent behavior settings edit these same persisted flags:

- `allowAgentFactInference`: infer missing facts only when enabled; when disabled, leave unsupported details unknown or ask the user;
- `requireEvidenceForNumericClaims`: attach source evidence to numeric claims when enabled;
- `allowForceExportWithOverflow`: only force export beyond page bounds when enabled;
- `autoResolveDeterministicComments`: resolve a comment after applying a matching change only when enabled.

These policies are workspace-level configuration, not CV content. Preserve other policy fields when updating workspace metadata.

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
