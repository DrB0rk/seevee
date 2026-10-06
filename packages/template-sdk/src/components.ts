// The four structural components every Seevee source template renders through.
//
// Import from here — not from `@seevee/template-sdk` — when you need the
// component *values*:
//
//   import { Page, Section, Item, Field } from '@seevee/template-sdk/components';
//
// They are real Astro components (see ./components/*.astro), so the toolchain
// importing them must be able to compile Astro: a template being rendered, or
// `@seevee/template-render`. The package's main entry point stays plain-Node
// importable for consumers that only need the read model and diagnostics.
//
// The rendered elements carry the `data-seevee-*` anchors the dashboard binds
// comments and narrow rerenders to. Attribute names are load-bearing —
// `packages/renderer/src/html.ts` documents the same contract for the
// non-Astro render path.
//
// IMPORTANT: this module is part of the SDK's safety boundary. It must NEVER
// reach for filesystem, process, network, or function-construction APIs that
// could leak to a template author's code. See safety.ts for the allowlist.

export { default as Page } from './components/Page.astro';
export { default as Section } from './components/Section.astro';
export { default as Item } from './components/Item.astro';
export { default as Field } from './components/Field.astro';

export type {
  PageProps,
  SectionProps,
  ItemProps,
  FieldProps,
} from './page-helpers.js';