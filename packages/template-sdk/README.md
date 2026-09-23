# @seevee/template-sdk

Public typed API exposed to Seevee source templates.

Templates import from `@seevee/template-sdk` to access:

- typed **CV read model** (`CvReadModel`, `CvSection`, `CvItem`, `SectionId`, `ItemId`, `FieldPath`);
- typed **presentation read model** (`PresentationReadModel`, `PageProfile`);
- Astro-compatible **Page / Section / Item / Field** component factories;
- **semantic bindings** (`bind.section`, `bind.item`, `bind.field`) — the
  `data-seevee-*` attribute hooks the dashboard uses to anchor comments and
  rerender narrow slots;
- pure **layout diagnostics** (`evaluatePageLayout`, `aggregateDiagnostics`,
  `hasOverflow`);
- **field path helpers** (`parseFieldPath`, `formatFieldPath`);
- a **safety allowlist** (`REJECTED_NODE_BUILTINS`, `REJECTED_GLOBALS`,
  `assertSafeSdk`, `isUnsafeImport`).

## Safety boundary

The SDK MUST NOT re-export `node:fs`, `node:child_process`, `node:net`,
`node:http`, `node:https`, `process`, `Buffer`, `eval`, or `Function`. The
`safety.ts` module documents the rejected set; CI enforces it via grep.

## Example

```astro
---
import { Section, Item, Field, getField } from '@seevee/template-sdk';
const { cv } = Astro.props;
---
<Section cv={cv} sectionId="experience-main">
  {#each cv.sectionOrder as sectionId}
    <Item cv={cv} itemId="role-senior-engineer" {sectionId}>
      <Field
        cv={cv}
        itemId="role-senior-engineer"
        sectionId={sectionId}
        fieldPath="/title"
        fallback={getField(cv, 'role-senior-engineer', '/title') ?? ''}
      />
    </Item>
  {/each}
</Section>
```

## Layout diagnostics

```ts
import {
  evaluatePageLayout,
  aggregateDiagnostics,
  hasOverflow,
  type PageContent,
  type PageProfile,
} from '@seevee/template-sdk';

const diagnostic = evaluatePageLayout(pageContent, pageProfile);
const render = aggregateDiagnostics([diagnostic]);

if (hasOverflow(render)) {
  // surface a warning in the dashboard
}
```

## Field paths

`FieldPath` is a JSON-Pointer-like string (`/role/title`). Use `parseFieldPath`
to split into segments and `formatFieldPath` to assemble. Segments honour the
RFC 6901 escapes (`~1` → `/`, `~0` → `~`).

## License

Internal to the Seevee project.
