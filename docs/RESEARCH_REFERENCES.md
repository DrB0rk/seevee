# Research References

Date checked: 2026-09-23

Use primary documentation when implementation details may have changed.

## JSON Schema

JSON Schema Draft 2020-12:

- https://json-schema.org/draft/2020-12
- https://json-schema.org/draft/2020-12/json-schema-core

Used for:

- modular schema dialect/version;
- `$defs` and `$ref`;
- strict schema composition;
- generated interoperability artifacts.

## Annotation/selector model

W3C Web Annotation Data Model:

- https://www.w3.org/TR/annotation-model/

Used as a design reference for:

- multiple selectors identifying the same logical target;
- TextQuoteSelector-style fallbacks;
- separating an annotation/comment body from its target.

Seevee does not attempt to implement the complete W3C model. It adopts the resilient-selector principle and specializes it for stable CV node IDs, template bindings and physical page regions.

## Astro

Astro on-demand rendering:

- https://docs.astro.build/en/guides/on-demand-rendering/

Astro Node adapter:

- https://docs.astro.build/en/guides/integrations-guide/node/

Used for:

- local Node-hosted dashboard/server architecture;
- server-rendered/API routes;
- standalone Node deployment.

Generated template source should still be compiled/validated before activation rather than using a mutable dev server as the production trust boundary.

## Playwright PDF

Playwright Page API:

- https://playwright.dev/docs/api/class-page

Used for:

- PDF output;
- CSS page-size priority via `preferCSSPageSize`;
- print backgrounds;
- physical page-size verification.

## npm executable mapping

npm package.json documentation:

- https://docs.npmjs.com/files/package.json/#bin

Used for:

- keeping the user-facing executable named `seevee` even when publishing the package under an official npm scope;
- cross-platform PATH installation.

## Detached local server

Node.js child_process documentation:

- https://nodejs.org/api/child_process.html#optionsdetached

Used for:

- spawning the local Seevee dashboard independently from `seevee init`;
- using detached process semantics;
- using `unref()`;
- redirecting stdio to log files so the invoking terminal can exit cleanly.

## Implementation rule

Before relying on a version-sensitive API, check the current primary documentation and pin supported versions in the repository. Do not copy unverified snippets from this plan into production code.
