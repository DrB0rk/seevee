// Prop contracts for the four structural components every Seevee source
// template renders through.
//
// The components themselves are real Astro components living in
// ./components/*.astro and are re-exported from ./components.ts:
//
//   import { Page, Section, Item, Field } from '@seevee/template-sdk/components';
//
// They emit the `data-seevee-*` anchors the dashboard binds comments and
// narrow rerenders to. Attribute names are load-bearing — `packages/renderer/
// src/html.ts` documents the same contract for the non-Astro render path.
//
// This module deliberately holds ONLY types: no `.astro` import, so any
// plain-Node package can depend on the prop contracts without pulling an
// unparseable file into its own program. `tsc` cannot read `.astro` files,
// and a consumer typechecking across this package would otherwise fail to
// resolve the component imports.
//
// IMPORTANT: this module is the SDK's safety boundary. It must NEVER reach
// for filesystem, process, network, or function-construction APIs that
// could leak to a template author's code. See safety.ts for the allowlist.

import type {
  CvReadModel,
  ItemId,
  PageProfile,
  PresentationReadModel,
  SectionId,
} from './types.js';

/** Props for `Page` — the root element wrapping one rendered template. */
export interface PageProps {
  readonly profile: PageProfile;
  readonly presentation?: PresentationReadModel;
}

/** Props for `Section` — one CV section, resolved by id. */
export interface SectionProps {
  readonly cv: CvReadModel;
  readonly sectionId: SectionId;
}

/** Props for `Item` — one CV entity, resolved by id. */
export interface ItemProps {
  readonly cv: CvReadModel;
  readonly itemId: ItemId;
  readonly sectionId?: SectionId;
}

/**
 * Props for `Field` — one field slot inside an item.
 *
 * `fallback` is rendered as *content* when the value at `fieldPath` is
 * missing or nullish; it is never stringified into an attribute.
 */
export interface FieldProps {
  readonly cv: CvReadModel;
  readonly itemId: ItemId;
  readonly sectionId: SectionId;
  readonly fieldPath: string;
  readonly fallback?: unknown;
}