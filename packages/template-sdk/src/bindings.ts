// Semantic binding helpers. Templates call these on Astro components to
// produce the `data-seevee-*` CSS hooks the dashboard uses to anchor comments
// and rerender narrow slots after edits.
//
// The bindings are pure data: factory functions that take identifiers and
// return attribute objects with stable string keys. The renderer (separate
// package) is what copies those keys onto rendered HTML elements.

import type { ItemId, SectionId } from './types.js';

// Interfaces use string-literal keys so consumers get autocomplete on
// `data-seevee-*` attribute names via the renderer.
export interface SectionBinding {
  readonly 'data-seevee-section': string;
}

export interface ItemBinding {
  readonly 'data-seevee-item': string;
  readonly 'data-seevee-section': string;
}

export interface FieldBinding {
  readonly 'data-seevee-field': string;
  readonly 'data-seevee-item': string;
  readonly 'data-seevee-field-path': string;
}

/**
 * Section id accepted by `bind.item`: branded, empty (no section), or null.
 * Templates pass `''` when an item hangs off the CV root rather than a
 * section, so we accept the empty string instead of forcing callers to map.
 */
export type SectionScope = SectionId | '' | null | undefined;

/**
 * The binding helper templates use. Pure, frozen, side-effect-free.
 */
export const bind = Object.freeze({
  /**
   * Bind a section. Returns `{ 'data-seevee-section': <id> }` and nothing
   * else so the attribute stays a stable key for downstream CSS lookups.
   */
  section(sectionId: SectionId): SectionBinding {
    return Object.freeze({ 'data-seevee-section': sectionId });
  },

  /**
   * Bind an item. The `sectionId` is optional — pass `null`, `undefined`,
   * or `''` for unsectioned items (those that hang off the CV root, like
   * an identity block).
   */
  item(itemId: ItemId, sectionId: SectionScope = null): ItemBinding {
    return Object.freeze({
      'data-seevee-item': itemId,
      'data-seevee-section': sectionId ?? '',
    });
  },

  /**
   * Bind a specific field slot inside an item. `fieldPath` is a JSON-Pointer
   * string the SDK does NOT validate here — validation happens in `getField`
   * so this stays a zero-cost constructor call in tight render loops.
   */
  field(itemId: ItemId, sectionId: SectionId, fieldPath: string): FieldBinding {
    return Object.freeze({
      'data-seevee-field': fieldPath,
      'data-seevee-item': itemId,
      'data-seevee-field-path': fieldPath,
    });
  },
});

export default bind;
