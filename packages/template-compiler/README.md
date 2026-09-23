# @seevee/template-compiler

Compiles a Seevee source template into an immutable, content-addressable
artifact directory. The compiler is the safety boundary: it rejects any
template that reaches for forbidden host APIs, validates the manifest,
runs `astro check` in a sandboxed child process, renders representative
fixtures, evaluates layout diagnostics, and writes a hashable artifact
plus a `compile-metadata.json` audit trail.

## Public surface

```ts
import {
  compileTemplate,
  CompileError,
  PolicyError,
  ManifestError,
  RenderError,
  validateManifest,
  runPolicyScan,
  renderFixtures,
  buildArtifact,
  computeArtifactId,
  canonicalJson,
  runAstroCheck,
  COMPILE_STAGES,
  readManifestFromDisk,
} from '@seevee/template-compiler';
```

## Compile lifecycle

`compileTemplate(options)` runs the stages in `TEMPLATE_AUTHORING.md §5`:

1. **policy-scan** — static scan over every source file; rejects any
   import of `node:fs`, `node:child_process`, `node:net`, `node:http`,
   `node:https`, `process`, `eval`, `Function`, or any specifier outside
   the template dependency allowlist.
2. **manifest-validation** — re-validates the supplied manifest against
   `templateManifestDocumentSchema` from `@seevee/schema`.
3. **type-check** — runs `astro check` in a child process with a heap
   cap (`--max-old-space-size=<memoryMb>`) and a timeout. Skipped with
   `level: 'skipped'` when astro is not on PATH.
4. **fixture-render** — walks every `*.json` fixture in `fixtureDir`,
   parses each as a CV, lays out a single page, and collects the
   resulting `PageContent[]`. The renderer in this package is a
   deterministic stub; the real `@seevee/renderer` will replace it
   via the same `renderFixtures` boundary.
5. **layout-diag** — runs each `PageContent` through
   `@seevee/template-sdk`'s `evaluatePageLayout`. Throws `RenderError`
   on any overflow.
6. **build** + **artifact-write** — copies the source tree to
   `outputRoot/<sha256>/`, writes `compile-metadata.json` with every
   diagnostic, returns the artifact metadata.

## Public types

```ts
interface CompileOptions {
  sourceRoot: string;
  manifest: TemplateManifest;
  fixtureDir: string;
  outputRoot: string;
  timeoutMs?: number; // default 30_000
  memoryMb?: number;  // default 512
}

interface CompileArtifact {
  artifactId: string;       // sha256 of source contents
  sourceRoot: string;
  outputRoot: string;
  manifest: TemplateManifest;
  manifestHash: string;
  compiledAt: string;
  diagnostics: readonly CompileDiagnostic[];
  pages: number;
  hasOverflow: boolean;
}

type CompileDiagnostic = {
  stage: 'policy-scan' | 'manifest-validation' | 'type-check'
       | 'fixture-render' | 'layout-diag' | 'build' | 'artifact-write';
  level: 'pass' | 'warn' | 'fail' | 'skipped';
  message: string;
  details?: Record<string, unknown>;
};
```

## Safety

The compiler never executes template source code in the parent process.
`astro check` runs in a child process with no read access above
`sourceRoot`. The fixture render step is purely data — it walks parsed
CV JSON and emits synthetic `PageContent` records. Real template
execution only happens when the user's dashboard loads the compiled
artifact via `import()` from the artifact path.

## Scripts

```bash
pnpm --filter @seevee/template-compiler exec vitest run
pnpm --filter @seevee/template-compiler run typecheck
```