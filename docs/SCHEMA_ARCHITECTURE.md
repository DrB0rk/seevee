# Schema Architecture

Status: normative design specification
Version: 0.1
Date: 2026-09-23

## 1. Design goals

The Seevee schema system must be:

- modular: each concern is independently versioned;
- stable: comments, provenance and layout bindings survive reorderings and ordinary edits;
- extensible: new section/entity types can be added without redesigning the entire document;
- agent-safe: model output is validated before it can mutate canonical state;
- provenance-aware: factual claims can be traced back to source material;
- presentation-independent: CV facts are not coupled to a particular Astro template;
- migration-friendly: every schema family has explicit versions and deterministic migrations;
- commentable: every meaningful semantic object can be targeted with resilient selectors;
- interoperable: runtime schemas can emit JSON Schema 2020-12 for external structured-output systems.

Use Zod as the runtime source of truth and generate JSON Schema artifacts. Do not maintain unrelated manual TypeScript interfaces and JSON Schema files.

The bootstrap machine-readable v1 specification is committed under `schemas/v1/`. Treat it as the implementation contract until the Zod package exists; once implementation starts, CI must generate/verify these artifacts from the canonical Zod modules.

## 2. Resource model

A workspace contains separately revisioned resources:

~~~text
workspace index
├── cvs/* (many independent CV documents)
├── provenance/* (typically one per CV)
├── presentations/* (many CV + template pairings)
├── comments/* (typically one per CV)
├── source registry
├── template source/version
├── style presets
├── compiled template artifacts
├── change sets
└── agent runs / diagnostics
~~~

The separation is intentional. A design change must not rewrite CV facts; a factual correction must not rewrite template source.

A workspace may contain any number of CV documents. Each CV is complete and independently revisioned. Do not encode job-specific variants as a large set of conditional flags inside one CV document.

A presentation explicitly references the CV it renders and the template/version it applies. This makes CVs and templates interchangeable by default while still allowing a presentation/template to be highly bespoke for one particular CV.

## 3. Common resource envelope

Every canonical JSON document uses the same envelope fields:

~~~json
{
  "kind": "seevee.cv",
  "schemaVersion": "1.0.0",
  "id": "cv_0199...",
  "revision": 14,
  "createdAt": "2026-09-23T00:15:20.000Z",
  "updatedAt": "2026-09-23T01:31:02.000Z",
  "data": {}
}
~~~

Fields:

| Field | Meaning |
|---|---|
| kind | Stable resource discriminator. |
| schemaVersion | Version of this resource family. |
| id | Stable resource ID. |
| revision | Monotonic integer used for optimistic concurrency. |
| createdAt | RFC 3339 timestamp. |
| updatedAt | RFC 3339 timestamp. |
| data | Resource-specific body. |

Unknown extension data belongs only in explicit extension maps, never as arbitrary undeclared properties throughout the schema.

## 4. IDs

Every independently editable, orderable, commentable, citeable or linkable semantic object gets a stable opaque ID.

Recommended form: UUIDv7 encoded as a string and optionally prefixed for readability.

Examples:

~~~text
cv_0199...
sec_0199...
exp_0199...
edu_0199...
prj_0199...
bul_0199...
skg_0199...
skl_0199...
lnk_0199...
src_0199...
prov_0199...
thr_0199...
msg_0199...
tpl_0199...
sty_0199...
chg_0199...
run_0199...
~~~

Rules:

- IDs survive reorderings.
- IDs survive wording edits.
- IDs survive template switches.
- IDs survive repagination.
- Deleted IDs are never reused.
- Array position is never identity.
- Do not encode employer names, dates, page numbers or other mutable semantics into IDs.

## 5. Shared primitives

### 5.1 Localized text

Use localized text only where localization matters. Ordinary user content can remain plain strings.

~~~json
{
  "default": "Software Engineer",
  "translations": {
    "nl-NL": "Software-engineer"
  }
}
~~~

### 5.2 Partial dates

Canonical dates must represent precision explicitly:

~~~json
{
  "precision": "month",
  "year": 2025,
  "month": 9
}
~~~

Allowed precision:

- year
- month
- day

Do not use ambiguous free-form date strings as canonical dates.

### 5.3 Time ranges

~~~json
{
  "start": { "precision": "month", "year": 2025, "month": 9 },
  "end": null,
  "isCurrent": true
}
~~~

If `isCurrent` is true, `end` must be null.

### 5.4 URL/link object

~~~json
{
  "id": "lnk_0199...",
  "label": "GitHub",
  "url": "https://github.com/example",
  "kind": "github",
  "visibility": "public"
}
~~~

### 5.5 Extension map

Every extensible object may contain:

~~~json
{
  "extensions": {
    "com.example.plugin": {
      "someFutureField": true
    }
  }
}
~~~

Extension namespaces must be globally unique enough to avoid collisions. Core code must preserve unknown extension namespaces during read/write cycles.

## 6. Semantic references

Persistent links between documents use semantic references.

### 6.1 NodeRef

~~~json
{
  "kind": "node",
  "nodeId": "exp_0199...",
  "nodeType": "experience"
}
~~~

### 6.2 FieldRef

A FieldRef identifies a field *inside a stable semantic node*.

~~~json
{
  "kind": "field",
  "nodeId": "exp_0199...",
  "nodeType": "experience",
  "field": "/role/title"
}
~~~

The field member uses RFC 6901 JSON Pointer syntax relative to the node.

Do not persist a positional path such as:

~~~text
/entities/experience/2/bullets/4
~~~

as the only reference.

### 6.3 SectionRef

~~~json
{
  "kind": "section",
  "sectionId": "sec_0199..."
}
~~~

### 6.4 TemplateBindingRef

~~~json
{
  "kind": "template-binding",
  "bindingId": "binding_experience_list",
  "templateVersionId": "tplv_0199..."
}
~~~

## 7. CV document

The CV document is a semantic graph with:

- identity/contact data;
- an ordered section registry;
- typed entity stores;
- metadata.

Do not hard-code every possible future CV section as a top-level field.

### 7.1 Top-level shape

~~~json
{
  "kind": "seevee.cv",
  "schemaVersion": "1.0.0",
  "id": "cv_0199...",
  "revision": 14,
  "createdAt": "2026-09-23T00:15:20.000Z",
  "updatedAt": "2026-09-23T01:31:02.000Z",
  "data": {
    "locale": "en-GB",
    "identity": {
      "id": "person_0199...",
      "name": {
        "given": "Alex",
        "family": "Example",
        "display": "Alex Example"
      },
      "headline": "Embedded Software Engineer",
      "summary": "Engineer focused on embedded systems and developer tooling.",
      "contact": {
        "email": "alex@example.com",
        "phone": null,
        "location": {
          "label": "Amsterdam, Netherlands",
          "countryCode": "NL"
        },
        "links": ["lnk_0199..."]
      }
    },
    "sectionOrder": [
      "sec_summary",
      "sec_experience",
      "sec_projects",
      "sec_education",
      "sec_skills"
    ],
    "sections": {
      "sec_experience": {
        "id": "sec_experience",
        "sectionType": "experience",
        "label": "Experience",
        "visibility": "visible",
        "itemRefs": [
          { "kind": "node", "nodeId": "exp_001", "nodeType": "experience" }
        ],
        "options": {}
      }
    },
    "entities": {
      "links": {},
      "experience": {},
      "education": {},
      "projects": {},
      "skillGroups": {},
      "skills": {},
      "certifications": {},
      "awards": {},
      "languages": {},
      "publications": {},
      "volunteering": {},
      "references": {},
      "custom": {}
    },
    "extensions": {}
  }
}
~~~

### 7.2 Why a section registry

Sections are presentation-order containers that point to semantic entities.

This allows:

- one experience entity to be moved without changing identity;
- a template to iterate a generic ordered section stream;
- new section types to be added without a root-schema rewrite;
- per-section comments and presentation overrides;
- alternate CV variants to reuse entities but choose different section order/visibility.

### 7.3 Experience entity

~~~json
{
  "id": "exp_001",
  "type": "experience",
  "organization": {
    "name": "Example Labs",
    "url": "https://example.com",
    "location": "Amsterdam"
  },
  "role": {
    "title": "Software Engineer",
    "employmentType": "part-time"
  },
  "period": {
    "start": { "precision": "month", "year": 2025, "month": 9 },
    "end": null,
    "isCurrent": true
  },
  "summary": "Worked on embedded acquisition systems and internal tooling.",
  "bulletOrder": ["bul_001", "bul_002"],
  "bullets": {
    "bul_001": {
      "id": "bul_001",
      "text": "Built tooling for synchronized sensor acquisition.",
      "tags": ["embedded", "tooling"]
    },
    "bul_002": {
      "id": "bul_002",
      "text": "Implemented automated validation for device data.",
      "tags": ["testing"]
    }
  },
  "technologyRefs": ["skl_typescript", "skl_rust"],
  "extensions": {}
}
~~~

Bullets use stable IDs rather than an anonymous string array so comments/provenance can target an individual bullet and survive reordering.

### 7.4 Education entity

~~~json
{
  "id": "edu_001",
  "type": "education",
  "institution": {
    "name": "Example University",
    "location": "Amsterdam"
  },
  "program": {
    "name": "Cybersecurity",
    "degree": "Associate Degree"
  },
  "period": {
    "start": { "precision": "year", "year": 2025 },
    "end": { "precision": "year", "year": 2027 },
    "isCurrent": false
  },
  "details": [],
  "extensions": {}
}
~~~

### 7.5 Project entity

~~~json
{
  "id": "prj_001",
  "type": "project",
  "name": "Seevee",
  "summary": "Agent-driven CV creation environment.",
  "period": null,
  "linkRefs": ["lnk_project_repo"],
  "bulletOrder": ["bul_prj_001"],
  "bullets": {
    "bul_prj_001": {
      "id": "bul_prj_001",
      "text": "Designed a schema-driven CV and review workflow."
    }
  },
  "technologyRefs": ["skl_astro", "skl_typescript"],
  "extensions": {}
}
~~~

### 7.6 Skills

Skills are reusable semantic nodes.

~~~json
{
  "skills": {
    "skl_typescript": {
      "id": "skl_typescript",
      "type": "skill",
      "name": "TypeScript",
      "category": "language",
      "level": null,
      "keywords": []
    }
  },
  "skillGroups": {
    "skg_languages": {
      "id": "skg_languages",
      "type": "skillGroup",
      "label": "Languages",
      "skillRefs": ["skl_typescript"]
    }
  }
}
~~~

Avoid arbitrary 1-10 skill scores by default. If a source explicitly contains proficiency, represent the source wording or a controlled level vocabulary and preserve provenance.

### 7.7 Custom entity types

The core supports future custom nodes through a namespaced custom registry:

~~~json
{
  "entities": {
    "custom": {
      "com.example.security-clearance": {
        "clearance_001": {
          "id": "clearance_001",
          "type": "custom:com.example.security-clearance",
          "data": {}
        }
      }
    }
  }
}
~~~

A custom entity must declare the extension schema that validates its `data`.

## 8. Provenance document

The provenance document answers: *where did this fact or claim come from?*

~~~json
{
  "kind": "seevee.provenance",
  "schemaVersion": "1.0.0",
  "id": "provdoc_001",
  "revision": 8,
  "createdAt": "...",
  "updatedAt": "...",
  "data": {
    "sources": {
      "src_001": {
        "id": "src_001",
        "sourceType": "pdf",
        "name": "old-cv.pdf",
        "contentHash": "sha256:...",
        "ingestedAt": "...",
        "metadata": {}
      }
    },
    "assertions": {
      "prov_001": {
        "id": "prov_001",
        "target": {
          "kind": "field",
          "nodeId": "exp_001",
          "nodeType": "experience",
          "field": "/role/title"
        },
        "evidence": [
          {
            "sourceId": "src_001",
            "locator": {
              "type": "page-text",
              "page": 1,
              "quote": "Software Engineer"
            }
          }
        ],
        "claimType": "explicit",
        "confidence": 1,
        "verifiedByUser": false
      }
    }
  }
}
~~~

Allowed claim types:

- explicit
- paraphrased
- inferred
- user-confirmed
- generated

"Inferred" must not be treated as equivalent to explicit source evidence. High-stakes or externally verifiable claims should prefer explicit/user-confirmed evidence.

## 9. Presentation document

Presentation controls how CV data is rendered without changing CV facts.

~~~json
{
  "kind": "seevee.presentation",
  "schemaVersion": "1.0.0",
  "id": "pres_001",
  "revision": 21,
  "createdAt": "...",
  "updatedAt": "...",
  "data": {
    "cvId": "cv_0199...",
    "template": {
      "templateId": "tpl_minimal",
      "versionId": "tplv_004",
      "stylePresetId": "sty_blue_dense"
    },
    "page": {
      "preset": "A4",
      "orientation": "portrait",
      "widthMm": 210,
      "heightMm": 297,
      "marginMm": {
        "top": 12,
        "right": 12,
        "bottom": 12,
        "left": 12
      },
      "bleedMm": 0
    },
    "pagination": {
      "targetPages": 1,
      "maxPages": 2,
      "overflowPolicy": "error"
    },
    "tokens": {
      "core": {
        "fontFamily": "Inter",
        "baseFontSizePt": 9.5,
        "lineHeight": 1.3,
        "density": 0.92,
        "columnGapMm": 7,
        "primaryColor": "#111111",
        "accentColor": "#2457d6"
      },
      "template": {}
    },
    "sectionOverrides": {
      "sec_projects": {
        "visibility": "visible",
        "pageBreakBefore": false,
        "keepTogether": false
      }
    },
    "templateOverrides": {},
    "extensions": {}
  }
}
~~~

Rules:

- A4 portrait is the default and must resolve to exactly 210 x 297 mm.
- Custom page dimensions use physical units.
- Dashboard controls modify only whitelisted presentation fields.
- Source template code is not embedded in presentation JSON.

## 10. Template manifest

Each template source version has a manifest:

~~~json
{
  "kind": "seevee.template-manifest",
  "schemaVersion": "1.0.0",
  "id": "tplv_004",
  "templateId": "tpl_minimal",
  "name": "Minimal",
  "version": "1.3.0",
  "entry": "src/Resume.astro",
  "engine": "astro",
  "capabilities": {
    "multiPage": true,
    "customPageSize": true,
    "comments": true,
    "twoColumn": true
  },
  "supportedCvSchema": ">=1.0.0 <2.0.0",
  "supportedPresentationSchema": ">=1.0.0 <2.0.0",
  "tokens": {
    "fontFamily": {
      "type": "font",
      "default": "Inter",
      "dashboardEditable": true
    },
    "baseFontSizePt": {
      "type": "number",
      "min": 7,
      "max": 14,
      "step": 0.25,
      "default": 9.5,
      "dashboardEditable": true
    },
    "density": {
      "type": "number",
      "min": 0.7,
      "max": 1.2,
      "step": 0.01,
      "default": 1,
      "dashboardEditable": true
    }
  },
  "bindings": [
    {
      "id": "binding_experience",
      "purpose": "experience-list"
    }
  ]
}
~~~

## 11. Style preset

A style preset is light-weight, reusable presentation state.

~~~json
{
  "kind": "seevee.style-preset",
  "schemaVersion": "1.0.0",
  "id": "sty_001",
  "name": "Dense blue technical",
  "templateId": "tpl_minimal",
  "templateVersionId": "tplv_004",
  "tokens": {
    "core": {
      "density": 0.88,
      "accentColor": "#2457d6"
    },
    "template": {}
  },
  "page": {
    "preset": "A4",
    "orientation": "portrait",
    "widthMm": 210,
    "heightMm": 297,
    "marginMm": {
      "top": 12,
      "right": 12,
      "bottom": 12,
      "left": 12
    },
    "bleedMm": 0
  },
  "sectionOverrides": {}
}
~~~

Saving the current style should create this object by default. It should not duplicate Astro source.

## 12. Comments document

Comments are independent review threads.

~~~json
{
  "kind": "seevee.comments",
  "schemaVersion": "1.0.0",
  "id": "comments_001",
  "revision": 6,
  "createdAt": "...",
  "updatedAt": "...",
  "data": {
    "threadOrder": ["thr_001"],
    "threads": {
      "thr_001": {
        "id": "thr_001",
        "category": "copy",
        "priority": "normal",
        "status": "open",
        "target": {
          "source": {
            "resource": "cv",
            "resourceId": "cv_0199...",
            "revisionAtCreation": 14
          },
          "selectors": [
            {
              "type": "FieldSelector",
              "nodeId": "bul_001",
              "nodeType": "bullet",
              "field": "/text"
            },
            {
              "type": "TextQuoteSelector",
              "exact": "Built tooling for synchronized sensor acquisition.",
              "prefix": "",
              "suffix": ""
            },
            {
              "type": "PageRegionSelector",
              "page": 1,
              "x": 0.10,
              "y": 0.42,
              "width": 0.64,
              "height": 0.04
            }
          ]
        },
        "messageOrder": ["msg_001"],
        "messages": {
          "msg_001": {
            "id": "msg_001",
            "author": {
              "type": "user",
              "id": "user_local"
            },
            "body": "Make this more concrete and shorter.",
            "createdAt": "..."
          }
        },
        "agentWork": {
          "state": "pending",
          "claimedByRunId": null,
          "changeSetIds": []
        },
        "resolution": null,
        "createdAt": "...",
        "updatedAt": "..."
      }
    }
  }
}
~~~

### 12.1 Selector types

Supported selector families:

#### NodeSelector

~~~json
{
  "type": "NodeSelector",
  "nodeId": "exp_001",
  "nodeType": "experience"
}
~~~

#### FieldSelector

~~~json
{
  "type": "FieldSelector",
  "nodeId": "exp_001",
  "nodeType": "experience",
  "field": "/role/title"
}
~~~

#### TextQuoteSelector

~~~json
{
  "type": "TextQuoteSelector",
  "exact": "Software Engineer",
  "prefix": "Role: ",
  "suffix": " · Amsterdam"
}
~~~

#### SectionSelector

~~~json
{
  "type": "SectionSelector",
  "sectionId": "sec_experience"
}
~~~

#### RenderBindingSelector

~~~json
{
  "type": "RenderBindingSelector",
  "templateVersionId": "tplv_004",
  "bindingId": "binding_experience"
}
~~~

#### PageRegionSelector

~~~json
{
  "type": "PageRegionSelector",
  "page": 1,
  "x": 0.10,
  "y": 0.42,
  "width": 0.64,
  "height": 0.04,
  "renderContext": {
    "cvRevision": 14,
    "presentationRevision": 21,
    "templateVersionId": "tplv_004"
  }
}
~~~

Page-region coordinates are normalized to 0..1 so the visual fallback survives zoom and pixel-density changes.

### 12.2 Target resolution

Resolve selectors in order from strongest semantic identity to weakest visual fallback.

Recommended sequence:

1. FieldSelector / NodeSelector
2. SectionSelector
3. RenderBindingSelector
4. TextQuoteSelector constrained to expected semantic scope
5. PageRegionSelector as a human-facing fallback clue

If multiple fallback targets are equally plausible, mark the thread ambiguous. Never guess silently.

### 12.3 Thread states

Allowed status:

- open
- in_progress
- applied
- resolved
- reopened
- blocked
- orphaned

An agent applying a patch moves a thread to `applied`, not automatically to `resolved`. Resolution is a separate acceptance decision unless a deterministic workspace policy explicitly permits auto-resolution.

## 13. Change-set document

Agent and user writes are represented as explicit change sets.

~~~json
{
  "kind": "seevee.change-set",
  "schemaVersion": "1.0.0",
  "id": "chg_001",
  "target": {
    "resourceKind": "seevee.cv",
    "resourceId": "cv_0199..."
  },
  "baseRevision": 14,
  "actor": {
    "type": "agent",
    "runId": "run_001"
  },
  "reason": {
    "commentIds": ["thr_001"],
    "summary": "Shorten the synchronized acquisition bullet."
  },
  "operations": [
    {
      "op": "field.set",
      "target": {
        "kind": "field",
        "nodeId": "bul_001",
        "nodeType": "bullet",
        "field": "/text"
      },
      "value": "Built tooling for synchronized sensor acquisition."
    }
  ],
  "createdAt": "..."
}
~~~

### 13.1 Domain operations

Use ID-aware operations:

- node.add
- node.remove
- node.move
- field.set
- field.unset
- text.replace
- section.add
- section.remove
- section.move
- presentation.set
- presentation.unset

JSON Patch can be supported for external interoperability, but positional JSON Patch operations should not be the canonical domain mutation format.

### 13.2 Optimistic concurrency

Every write contains `baseRevision`.

If current revision != baseRevision:

1. reject the write;
2. reload the canonical resource;
3. re-resolve targets;
4. rebase or regenerate operations;
5. validate again.

Never use last-write-wins for agent mutations.

## 14. Workspace library/index (`seevee.json`)

~~~json
{
  "kind": "seevee.workspace",
  "schemaVersion": "1.0.0",
  "id": "ws_001",
  "revision": 3,
  "createdAt": "...",
  "updatedAt": "...",
  "data": {
    "name": "Alex Example CV",
    "activeResources": {
      "cvId": "cv_0199...",
      "provenanceId": "provdoc_001",
      "presentationId": "pres_001",
      "commentsId": "comments_001"
    },
    "files": {
      "cv": "cv.json",
      "provenance": "provenance.json",
      "presentation": "presentation.json",
      "comments": "comments.json"
    },
    "sources": ["src_001"],
    "template": {
      "templateId": "tpl_minimal",
      "versionId": "tplv_004"
    },
    "policy": {
      "allowAgentFactInference": false,
      "requireEvidenceForNumericClaims": true,
      "allowForceExportWithOverflow": false,
      "autoResolveDeterministicComments": false
    },
    "extensions": {}
  }
}
~~~

## 15. Agent run state

Agent-state is operational rather than canonical CV content.

~~~json
{
  "kind": "seevee.agent-run",
  "schemaVersion": "1.0.0",
  "id": "run_001",
  "type": "comment-fix",
  "state": "completed",
  "inputRevisions": {
    "cv_0199...": 14,
    "comments_001": 6
  },
  "commentIds": ["thr_001"],
  "changeSetIds": ["chg_001"],
  "checks": {
    "schema": { "status": "passed" },
    "semanticReferences": { "status": "passed" },
    "render": { "status": "passed" },
    "overflow": { "status": "passed" }
  },
  "summary": "Shortened one experience bullet while preserving factual meaning.",
  "startedAt": "...",
  "completedAt": "..."
}
~~~

Do not store private chain-of-thought. Store only concise operational summaries, tool results, diagnostics, evidence references and decisions needed for product behavior.

## 16. Multi-CV workspace invariants

The workspace index tracks many CVs and presentations.

Recommended file model:

~~~text
cvs/<cv-id>.json
provenance/<cv-id>.json
comments/<cv-id>.json
presentations/<presentation-id>.json
~~~

A CV entry in `seevee.json` records its file path plus associated provenance/comments resources and optional default presentation. A presentation entry records its file path and target CV ID.

Rules:

- every CV file has a unique CV resource ID;
- every presentation references exactly one CV ID;
- a CV may have zero, one or many presentations;
- many CVs may use the same template/version;
- one CV may use many different templates;
- a template may be tagged `reusable`, `targeted`, or `bespoke`, but this tag is advisory;
- template design intent never hard-blocks applying it to another CV;
- CV JSON never embeds Astro/CSS source or a required template.

## 17. Semantic validation

JSON Schema validates structure. A separate semantic validator must enforce cross-document invariants.

Checks include:

- sectionOrder contains each active section at most once;
- every section itemRef resolves;
- node type matches the referenced entity store;
- every skill/link reference resolves;
- comment selectors reference valid resources or have explicit orphan state;
- provenance targets resolve;
- presentation overrides reference existing sections;
- selected template supports current schema versions;
- selected style preset belongs to the active template lineage;
- A4 preset always resolves to 210 x 297 mm before orientation transform;
- current-date range constraints are valid;
- IDs are unique within their resource namespace;
- source/provenance references are not dangling.

## 18. Schema versioning

Each resource family versions independently.

Use semantic-version-like rules:

- patch: constraint/documentation clarification with no incompatible accepted shape change;
- minor: backward-compatible additions;
- major: incompatible change.

Examples:

~~~text
seevee.cv 1.2.0
seevee.comments 1.1.0
seevee.presentation 1.4.0
~~~

A workspace can therefore upgrade comments without forcing a CV schema migration.

## 19. Migrations

Every supported migration is deterministic code:

~~~text
migrateCv_1_0_0_to_1_1_0()
migrateComments_1_0_0_to_1_1_0()
~~~

Requirements:

- pure where practical;
- idempotent at the orchestration boundary;
- fixture-tested;
- no model calls;
- preserve unknown extension namespaces;
- generate a migration report;
- never silently discard fields.

If an old version cannot be migrated safely, stop with a clear compatibility error.

## 20. Generated JSON Schema

Generate JSON Schema Draft 2020-12 from Zod at build/test time.

Recommended output:

~~~text
packages/schema/generated/json-schema/
  common.schema.json
  cv.schema.json
  provenance.schema.json
  presentation.schema.json
  comments.schema.json
  workspace.schema.json
  change-set.schema.json
  template-manifest.schema.json
  style-preset.schema.json
~~~

Commit generated artifacts so:

- external agent/model tooling can consume them;
- schema diffs are reviewable;
- downstream integrations do not require importing TypeScript.

CI fails if generated artifacts differ from the canonical Zod source.

## 21. Schema test matrix

Every schema module requires:

- minimum valid fixture;
- realistic full fixture;
- invalid required-field fixture;
- invalid discriminator fixture;
- invalid ID/reference fixture;
- boundary fixture;
- extension-preservation fixture;
- migration fixture;
- round-trip serialization fixture.

Additional comment tests:

- target survives entity reorder;
- target survives section reorder;
- target survives ordinary text edit through semantic selector;
- TextQuote fallback survives surrounding text changes;
- page region remains valid under zoom;
- target becomes orphaned when node is intentionally deleted;
- ambiguous fallback is detected rather than guessed;
- template switch preserves semantic comments.

Additional provenance tests:

- one field with multiple sources;
- conflicting source values;
- inferred versus explicit evidence;
- generated wording with factual subclaims;
- source deletion/deactivation policy.

## 22. Implementation rule

Implement these contracts before dashboard, ingestion or template-agent complexity.

The first production milestone is not a pretty editor. It is a stable, tested, migratable, cross-document schema layer with referential integrity and fixtures.
