/// <reference path="../.astro/types.d.ts" />
/// <reference types="astro/client" />

interface ImportMetaEnv {
  readonly SEEVEE_WORKSPACE_ROOT?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}