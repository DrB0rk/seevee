# Final repository architecture and cleanup audit

Date: 2026-09-23
Repository: `DrB0rk/seevee`
Scope: full current repository tree
Status: architecture/bootstrap repository cleaned and internally consistent; production runtime still not implemented

## Executive result

The repository has been reorganized around a hard audience boundary:

~~~text
.dev/                         repository development only
skills/seevee-workspace-agent end-user CV agent runtime guidance
docs/workspace-agent/         end-user CV agent reference material
schemas/                      actual product data contracts
examples/                     actual product/workspace fixtures
install.sh                    actual product installer bootstrap
README.md                     public project overview
VERSION / CHANGELOG.md        product release metadata
~~~

Repository-development instructions no longer coexist with workspace/CV-agent instructions in the same documentation namespace.

Duplicate development documents and the old `skills/seevee-agent/` skill path were removed.

## Final repository boundary

### Repository-development control plane

Everything for maintainers and development agents now lives under `.dev/`:

- `.dev/AGENTS.md`
- `.dev/DEVELOPMENT.md`
- `.dev/CONTRIBUTING.md`
- `.dev/VERSIONING.md`
- `.dev/RELEASING.md`
- `.dev/QUALITY_GATES.md`
- `.dev/IMPLEMENTATION_STATUS.md`
- `.dev/specs/*`
- `.dev/research/*`
- `.dev/audits/*`

This material is explicitly forbidden from being copied into an end-user workspace.

### Workspace/CV-agent product material

User-facing agent behavior is isolated under:

- `skills/seevee-workspace-agent/`
- `docs/workspace-agent/`

The skill explicitly tells an agent to stop and use `.dev/AGENTS.md` if it detects that the task is development of Seevee itself.

The workspace-agent material contains:

- CV ingestion/editing behavior;
- fact/provenance constraints;
- comment workflow;
- user-template behavior;
- CV/resume writing guidance;
- workspace CLI/runtime usage.

It does not contain repository contribution/release policy.

## Issues found and fixed during the audit

### High — agent audience ambiguity

**Previous state:** repository contribution instructions and user CV-agent instructions both used generic "agent" naming across root `AGENTS.md`, `docs/AGENT_*`, and `skills/seevee-agent/`.

**Risk:** an external agent could follow CV-editing rules while modifying the repository, or copy repository-maintainer instructions into a user's CV workspace.

**Fix:**

- moved maintainer instructions to `.dev/AGENTS.md`;
- renamed skill to `skills/seevee-workspace-agent/`;
- added explicit audience declarations;
- added separate documentation indexes;
- removed old duplicate paths.

Status: **Fixed**.

### High — duplicated canonical development documentation

**Previous state:** the same architecture documents existed both in `docs/*.md` and `docs/development/*.md`.

**Risk:** contradictory edits and uncertain canonical source.

**Fix:** one authoritative copy now exists under `.dev/specs/`; old copies were deleted.

Status: **Fixed**.

### High — invalid nested JSON Pointer schema

**Previous state:** the common `jsonPointer` pattern accepted only the empty pointer or a single pointer segment. Valid field references such as `/role/title` did not satisfy the schema.

**Fix:** changed pattern to:

~~~text
^(?:/(?:[^~/]|~0|~1)*)*$
~~~

Verification:

- empty/root pointer accepted;
- `/role/title` accepted;
- all internal schema references still resolve.

Status: **Fixed**.

### Medium — source registry lacked file resolution

**Previous state:** `seevee.json` contained an array of source IDs but no source-ID-to-file mapping.

**Risk:** workspace discovery could not deterministically locate source resource documents.

**Fix:** sources are now indexed under:

~~~json
{
  "resources": {
    "sources": {
      "src_demo": {
        "path": "sources/src_demo.json"
      }
    }
  }
}
~~~

The example workspace was migrated.

Status: **Fixed**.

### Medium — page-count policy was unnecessarily strict

**Previous state:** presentation pagination required both `targetPages` and `maxPages`.

**Risk:** the data contract implicitly forced page-count intent even for bespoke CVs where the user/agent intentionally had no page limit.

**Fix:** both fields are nullable/optional preferences; only overflow policy is required.

Status: **Fixed**.

### Medium — stale examples after schema changes

**Previous state:** schema/spec examples still showed the old source-list structure and one PageRegionSelector example omitted its required render context.

**Fix:** examples/spec text were aligned with the current schemas.

Status: **Fixed**.

### Medium — no explicit version/release/contribution standard

**Previous state:** installation/release architecture existed but repository governance was incomplete.

**Fix:** added:

- root `VERSION`: `0.1.0-alpha.0`;
- root `CHANGELOG.md`;
- SemVer 2.0.0 policy;
- Conventional Commits policy;
- branch/PR/review standards;
- release PR/tag/artifact process;
- prerelease/hotfix/rollback rules;
- quality-gate specification.

Status: **Fixed**.

### Low — development artifacts polluted product tree

**Previous state:** development plans/specs occupied the normal `docs/` tree and root `AGENTS.md`.

**Fix:** all maintainer-only material moved into hidden root `.dev/`.

Status: **Fixed**.

## Verification performed

### Repository tree

Verified after cleanup:

- no root `AGENTS.md`;
- no `docs/development/`;
- no legacy `docs/AGENT_*.md`;
- no legacy architecture specs under normal `docs/`;
- no `skills/seevee-agent/`;
- one workspace-agent skill path;
- one maintainer control-plane path.

### JSON Schema reference audit

Parsed all 12 v1 schema files.

Result:

~~~text
schemas checked:       12
internal refs checked: 285
broken refs:           0
~~~

### JSON Pointer verification

Result:

~~~text
pattern:                ^(?:/(?:[^~/]|~0|~1)*)*$
empty pointer:          valid
/role/title:            valid
~~~

### Linked workspace consistency

Validated resource relationships for the example workspace:

- active CV exists;
- active presentation exists;
- presentation references active CV;
- CV ID matches index;
- provenance ID matches CV entry;
- comments ID matches CV entry;
- source resource is indexed;
- provenance evidence source resolves.

Result: **0 relationship errors**.

### Installer/distribution policy

Verified architectural policy remains:

- public install path is GitHub-hosted `install.sh`;
- end users do not install Seevee through npm;
- release bundles are checksum verified;
- production release artifacts do not exist yet.

## Development policy added

### Versioning

Application/runtime:

- Semantic Versioning 2.0.0;
- pre-1.0: `0.MINOR.PATCH`;
- prerelease examples: `0.2.0-alpha.1`, `beta.1`, `rc.1`.

Schema families version independently.

Templates version independently.

### Contributions

- short-lived branches;
- Conventional Commits 1.0.0;
- squash merge recommended;
- migration/contract classification required for schema PRs;
- agent-authored contributions receive the same review as human-authored changes.

### Releases

Normal PR merges do not release.

Release flow:

1. green main;
2. release branch/PR;
3. bump `VERSION`;
4. finalize CHANGELOG;
5. pass release gates;
6. merge;
7. tag `vX.Y.Z`;
8. CI builds artifacts from tag;
9. generate `SHA256SUMS`;
10. draft GitHub Release;
11. smoke-test installer against release assets;
12. maintainer publishes.

Existing version assets must never be replaced with different bytes.

## What remains to implement

No audit issue should obscure the main fact: Seevee is not yet a production application.

The detailed source of truth is `.dev/IMPLEMENTATION_STATUS.md`.

### P0 — foundation

Not implemented:

- pnpm/TypeScript monorepo;
- Zod canonical schema package;
- generated JSON Schema pipeline;
- semantic validator;
- migration framework;
- CI.

### P1 — CLI/workspace runtime

Not implemented:

- production `seevee` executable;
- `seevee init`;
- server lifecycle;
- workspace CRUD;
- atomic writes;
- validate/doctor/status/open/start/stop/restart.

### P2 — dashboard

Not implemented:

- Astro/React application;
- CV library UI;
- live file watcher;
- SSE;
- comments UI;
- diagnostics UI.

### P3 — renderer/export

Not implemented:

- template SDK;
- physical-page renderer;
- semantic render bindings;
- layout diagnostics;
- Playwright PDF export.

### P4 — ingestion/provenance

Not implemented:

- source adapters;
- PDF/DOCX extraction;
- URL/HTML ingestion;
- provenance service;
- conflict handling.

### P5 — workspace-agent execution support

Not implemented:

- typed runtime tools/API;
- comment target resolver;
- change-set executor;
- agent-run service;
- template compilation sandbox.

### P6 — releases

Bootstrap only:

- `install.sh` exists.

Still required:

- platform runtime archives;
- Windows installer;
- GitHub Actions release pipeline;
- checksums from real artifacts;
- installer integration tests.

## Non-blocking design observations

### Workspace AGENTS.md is intentional

The product design still allows `seevee init` to create a generic `AGENTS.md` in a **user workspace**. This is not the deleted repository root developer guide.

That workspace file should point to the workspace-agent bundle and never to `.dev/`.

Status: **Accepted**.

### Long-form CV guidance and skill summary both exist

`docs/workspace-agent/CV_GUIDANCE.md` is the maintained long-form research reference.

`skills/seevee-workspace-agent/references/cv-guidance.md` is the compact distributable operational reference.

This duplication has a defined purpose. Future CI should detect obvious drift or generate the compact form if practical.

Status: **Accepted**, future automation recommended.

## Final assessment

Architecture/documentation cleanliness: **Pass**

Agent audience separation: **Pass**

Schema internal reference integrity: **Pass**

Example workspace linkage: **Pass**

Version/contribution/release governance: **Pass**

Production runtime completeness: **Not implemented**

Release readiness: **Not ready**

The repository is now in a clean state for implementation. The next correct development action is P0 from `.dev/IMPLEMENTATION_STATUS.md`, not further architecture proliferation.
