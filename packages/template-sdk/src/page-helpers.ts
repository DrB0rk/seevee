// Page/Section/Item/Field component helpers. These return plain element
// descriptors (no Node APIs, no filesystem, no network) that the renderer
// compiles to HTML with the correct `data-seevee-*` attributes.
//
// Astro compatibility: descriptors use the standard `astro/jsx-runtime`
// shape so a `.astro` template can render them directly with `<Page ... />`.
//
// IMPORTANT: this module is the SDK's safety boundary. It must NEVER reach
// for filesystem, process, network, or function-construction APIs that
// could leak to a template author's code. See safety.ts for the allowlist.

import type { ItemId, SectionId, CvSection, CvItem } from './types.js';
import type { CvReadModel } from './types.js';
import type { PageProfile, PresentationReadModel } from './types.js';
import { bind } from './bindings.js';
import { getSection, getItem } from './cv-helpers.js';

/**
 * The descriptor shape returned by every component helper. Astro sees this
 * via `astro/jsx-runtime` and renders it the same way it renders its built-in
 * elements. We type it as `unknown` here so we don't depend on Astro's
 * runtime types (the renderer is the only consumer that needs them).
 */
export type AstroElement = {
  readonly __astro_element: true;
  readonly tag: string;
  readonly props: Readonly<Record<string, unknown>>;
};

function element(tag: string, props: Record<string, unknown>): AstroElement {
  return Object.freeze({
    __astro_element: true as const,
    tag,
    props: Object.freeze({ ...props }),
  });
}

/**
 * Root element of a template. Wraps every section/item/field inside one
 * presentation.
 */
export function Page(props: {
  profile: PageProfile;
  presentation?: PresentationReadModel;
  children?: unknown;
}): AstroElement {
  return element('main', {
    'data-seevee-page': 'true',
    'data-seevee-page-preset': props.profile.preset,
    'data-seevee-page-orientation': props.profile.orientation,
    children: props.children,
  });
}

/**
 * Section element. Pulls the section title from the CV read model and emits
 * a `data-seevee-section` hook the dashboard uses to anchor section-level
 * comments. Returns a descriptor for the renderer to compile; missing
 * sections render as an empty `<section data-seevee-empty="true">`.
 */
export function Section(props: {
  cv: CvReadModel;
  sectionId: SectionId;
  children?: unknown;
}): AstroElement {
  const section: CvSection | null = getSection(props.cv, props.sectionId);
  if (section === null) {
    return element('section', {
      ...bind.section(props.sectionId),
      'data-seevee-empty': 'true',
      children: props.children,
    });
  }
  return element('section', {
    ...bind.section(props.sectionId),
    'data-seevee-section-type': section.type,
    'data-seevee-section-title': section.title,
    'data-seevee-section-visible': String(section.visible),
    children: props.children,
  });
}

/**
 * Item element. Pulls the item from the CV read model and emits hooks for
 * the dashboard's item-level rerendering.
 */
export function Item(props: {
  cv: CvReadModel;
  itemId: ItemId;
  sectionId?: SectionId;
  children?: unknown;
}): AstroElement {
  const item: CvItem | null = getItem(props.cv, props.itemId, props.sectionId);
  const sectionHook = props.sectionId ?? '';
  if (item === null) {
    return element('div', {
      ...bind.item(props.itemId, sectionHook),
      'data-seevee-empty': 'true',
      children: props.children,
    });
  }
  return element('div', {
    ...bind.item(props.itemId, sectionHook),
    'data-seevee-item-type': item.type,
    children: props.children,
  });
}

/**
 * Field element. Renders a single data-seevee-field-anchored slot. Actual
 * text/value lookup happens in the renderer; the descriptor just carries the
 * field path so the renderer's narrowing logic knows what to re-render.
 */
export function Field(props: {
  cv: CvReadModel;
  itemId: ItemId;
  sectionId: SectionId;
  fieldPath: string;
  fallback?: unknown;
}): AstroElement {
  return element('span', {
    ...bind.field(props.itemId, props.sectionId, props.fieldPath),
    'data-seevee-fallback': props.fallback === undefined ? '' : String(props.fallback),
  });
}
