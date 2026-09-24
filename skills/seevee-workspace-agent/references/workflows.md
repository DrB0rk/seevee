# Seevee agent workflows

## Create a new CV

Creating a CV includes its visible design. Do not finish after writing `cvs/<id>.json`.

1. Create the schema-valid CV document with stable IDs and verified facts.
2. Create a presentation registered to that CV, with an explicit page profile and visual tokens.
3. Choose a source template. Use the installed `classic` template as the styled default when the user has not supplied a direction; adapt or create a local Astro/CSS template when the request calls for a distinct look.
4. Register the template in `seevee.json` and point the presentation at its template/version IDs.
5. Validate the manifest, CV, presentation, and workspace references together.
6. Render the CV and correct page breaks, typography, spacing, and overflow before calling the new CV complete.

Do not ask the user to configure a template before producing a first visual result. Use the supplied brief when present, otherwise use the installed Classic design and make its styling visible in the new presentation.

## Ingest a source

1. Register and hash the source.
2. Run deterministic extraction first.
3. Preserve source locators.
4. Produce candidate facts under the extraction schema.
5. Compare with existing canonical nodes.
6. Merge only non-conflicting facts.
7. Surface conflicts rather than selecting silently.
8. Create/update provenance assertions.
9. Validate structural and referential integrity.
10. Commit as a revisioned change set.

## Edit CV content

1. Read requested node/field and provenance.
2. Decide whether the request is wording or factual.
3. For wording, preserve underlying facts.
4. For facts, require user/source support where the current evidence does not support the new value.
5. Preserve IDs for existing semantic nodes.
6. Apply typed mutation with base revision.
7. Validate and rerender.

## Apply comments

1. Load open/reopened threads.
2. Resolve target selectors against current workspace revisions.
3. Mark ambiguous/orphaned targets instead of guessing.
4. Classify each actionable thread.
5. Group only compatible comments; do not bundle unrelated changes into one opaque mutation.
6. Apply through the narrowest mutation interface.
7. Run relevant validation/render checks.
8. Link change sets to thread IDs.
9. Mark successful work `applied`; mark missing-information cases `blocked`.

## Create a new template

1. Read CV schema, template manifest contract and active page profile.
2. Start from the minimal template SDK scaffold.
3. Generate only allowlisted Astro/CSS/assets.
4. Add semantic binding helpers throughout.
5. Declare capabilities and presentation tokens in manifest.
6. Validate imports/source rules.
7. Run Astro checks.
8. Render representative fixtures including sparse, normal and dense CVs.
9. Verify A4 portrait first.
10. Check custom/Letter profiles if capability is declared.
11. Run clipping/page diagnostics.
12. Generate and inspect PDF output before activating.

## Save current style

Create a style preset referencing the current source template. Copy presentation token/layout overrides and page settings according to user choice. Do not duplicate Astro source unless explicitly forking.

## Finish any rendered change

Minimum checks:

- schema valid;
- semantic references valid;
- no stale write;
- template valid if touched;
- preview renders;
- comment bindings resolve;
- no unintended overflow/clipping;
- page count is understood;
- export readiness passes when export-relevant.
