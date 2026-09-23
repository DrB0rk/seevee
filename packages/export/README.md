# `@seevee/export`

PDF export pipeline for Seevee — turns a CV / workspace / presentation
triple into a deterministic, paginated PDF. The implementation mirrors
[DEVELOPMENT_PLAN.md §12](../../.dev/specs/DEVELOPMENT_PLAN.md#12-pdf-export)
end-to-end and respects the layout-diagnostics contract from §11.

## When the package runs

The pipeline is invoked by the dashboard / export tool when the user
asks to print a presentation. It runs in three contexts:

- **Production** — the dashboard host process, where Playwright + a
  Chromium binary are available.
- **Test** — vitest injects a fake Playwright module
  (`tests/fake-playwright.ts`). The real `playwright` package never
  has to be installed.
- **CLI / scripts** — the same production path as the dashboard.

## Public surface

```ts
import {
  exportToPdf,
  isPlaywrightAvailable,
  isPlaywrightInstalledAt,
  ExportError,
  RenderDiagnosticsError,
  PlaywrightNotInstalledError,
  PdfValidationError,
  ValidationError,
  TemplateArtifactError,
  IoError,
  type ExportOptions,
  type ExportResult,
  type ExportMetadataRecord,
} from '@seevee/export';
```

`ExportOptions` and `ExportResult` are the only two types the caller
needs to reach for.

## Pipeline

Per DEVELOPMENT_PLAN.md §12 the function executes these steps:

1. validate canonical resources (CV, workspace, presentation);
2. load the compiled template artifact at `templateArtifactPath`;
3. render via `@seevee/renderer.renderPresentationToHtml`;
4. feed the HTML through Playwright with `waitUntil: 'load'`
   (fonts + stylesheets are awaited by Chromium);
5. read the renderer's layout diagnostics;
6. **block** on fatal overflow / clipping unless
   `allowForcedExport: true`;
7. call `page.pdf(...)` with `printBackground: true` and the active
   page profile dimensions;
8. verify the resulting PDF's page count and physical dimensions
   (`pdfinfo` first; raw trailer-scan fallback);
9. write the export metadata to
   `<workspaceRoot>/.seevee/exports/<exportId>.json`;
10. return `ExportResult`.

## Diagnostics-blocking policy

```ts
await exportToPdf({
  workspaceRoot,
  cvId,
  presentationId,
  templateArtifactPath,
  outputPath,
  pageProfile: { preset: 'A4', orientation: 'portrait' },
  // allowForcedExport defaults to false. When the renderer reports
  // totalOverflow > 0 or hasClipping === true, the pipeline throws
  // RenderDiagnosticsError carrying the diagnostics so the caller
  // can surface them in the UI.
});
```

To force an export despite known overflow:

```ts
await exportToPdf({ ...allowForcedExport: true });
```

The pipeline never hides overflow to make validation pass — the
`RenderDiagnostics` is always returned on success and carried inside
`RenderDiagnosticsError.diagnostics` on failure.

## Playwright install

`playwright` is declared a peer dependency marked optional. The
production runtime is responsible for installing both the package and
the Chromium binary:

```sh
pnpm add -D playwright
pnpm exec playwright install chromium
```

If the package is missing, `isPlaywrightAvailable()` returns `false`
and `exportToPdf()` throws `PlaywrightNotInstalledError` with the
command above verbatim.

## Metadata shape

`ExportResult` is round-tripped to JSON in
`<workspaceRoot>/.seevee/exports/<exportId>.json`. The directory is
created on demand. Records are stable and identical in-memory and
on-disk; the split exists only so future revisions can extend the
on-disk record independently.

```jsonc
{
  "outputPath": "/abs/cv.pdf",
  "pageCount": 3,
  "pageProfile": { "preset": "A4", "orientation": "portrait" },
  "bytes": 12345,
  "sha256": "...64 hex...",
  "exportId": "exp_2026-01-01T00-00-00-000Z_<32 hex>",
  "startedAt": "2026-01-01T00:00:00.000Z",
  "completedAt": "2026-01-01T00:00:01.234Z",
  "diagnostics": { ... RenderDiagnostics ... }
}
```

## Testing

```sh
pnpm --filter @seevee/export exec vitest run
```

The suite never requires Playwright — the fake module in
`tests/fake-playwright.ts` implements only the surface we consume
(`chromium.launch`, `newPage`, `setContent`, `pdf`, `close`) and
writes a minimal but valid multi-page PDF whose `/Count` matches the
renderer's page count.

## Constraints

- TypeScript strict ESM (NodeNext), per `tsconfig.base.json`.
- No `any`, no `as any`, no dynamic `await import()` for known
  modules, no `new Promise((resolve, reject) => ...)` —
  `Promise.withResolvers` everywhere.
- Playwright is a peer (optional), never bundled.

## File layout

```
packages/export/
  package.json
  tsconfig.json
  vitest.config.ts
  README.md
  src/
    index.ts             # public exports
    export.ts            # exportToPdf orchestration
    validate.ts          # canonical-resource validation
    template-load.ts     # compiled-artifact loader
    playwright.ts        # gate + thin wrapper
    pdf-info.ts          # pdfinfo + trailer-scan fallback
    metadata.ts          # .seevee/exports/*.json writer
    errors.ts            # ExportError hierarchy
    types.ts             # ExportOptions / ExportResult / PlaywrightModule
  tests/
    export.test.ts
    fake-playwright.ts
    fixtures/
      cv.json
      workspace.json
      presentation.json
      dense-cv.json
      workspace-dense.json
      presentation-dense.json
      template/
        manifest.json
        source.astro
```
