// Public entry point for `@seevee/template-compiler`. Templates don't import
// from this package — it is consumed by the workspace / studio layer that
// owns the compile lifecycle. The exports are deliberately explicit rather
// than `export *` so every published symbol is a deliberate contract term.

export {
  compileTemplate,
  readManifestFromDisk,
  COMPILE_STAGES,
} from './compile.js';

export { runPolicyScan } from './policy-scan.js';

export { validateManifest } from './manifest.js';

export { renderFixtures } from './fixture-render.js';

export { buildArtifact, computeArtifactId, canonicalJson } from './artifact.js';

export { runAstroCheck } from './astro-check.js';

export {
  CompileError,
  PolicyError,
  ManifestError,
  RenderError,
} from './errors.js';

export type {
  CompileArtifact,
  CompileDiagnostic,
  CompileLevel,
  CompileOptions,
  CompileStage,
  TemplateManifest,
} from './types.js';