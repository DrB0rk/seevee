// CV helper utilities — derive a CvReadModel from a CvDocument and provide
// section/item/field lookups by ID. Templates use these instead of walking
// the raw maps in `@seevee/schema`.

import type { CvDocument, CvEntity } from '@seevee/schema';
import type { CvReadModel, CvItem, CvSection, ItemId, SectionId } from './types.js';
import { parseFieldPath } from './field-path.js';

/**
 * Build a CvReadModel from a parsed CV document. The model is intentionally
 * immutable: every nested record is frozen with Object.freeze so template
 * code cannot mutate the underlying data and break the safety contract.
 */
export function deriveCv(document: CvDocument): CvReadModel {
  const sections: Record<SectionId, CvSection> = {};
  for (const [rawId, section] of Object.entries(document.data.sections)) {
    sections[rawId as SectionId] = Object.freeze({ ...section });
  }

  const items: Record<ItemId, CvItem> = {};
  // Section-level ids may reference any entity store; build a flat map of
  // every entity so getItem works for roles, bullets, projects, etc.
  // The entities field is a record of records; flat-map every entity into
  // a single id → CvEntity map so getItem works for roles, bullets,
  // projects, etc., regardless of which store they came from.
  const entityStores = document.data.entities as unknown as Readonly<
    Record<string, Readonly<Record<string, CvEntity>> | undefined>
  >;
  for (const store of Object.values(entityStores)) {
    if (store === undefined) continue;
    for (const [entityId, value] of Object.entries(store)) {
      items[entityId as ItemId] = Object.freeze({ ...value });
    }
  }

  const sectionOrder: readonly SectionId[] = Object.freeze(
    document.data.sectionOrder.map((id) => id as SectionId),
  );

  return Object.freeze({
    document,
    sections,
    items,
    sectionOrder,
  });
}

/**
 * Look up a section by id. Returns `null` when the id is unknown; the spec
 * requires this exact behaviour so templates can branch on missing data
 * without try/catching.
 */
export function getSection(cv: CvReadModel, sectionId: SectionId): CvSection | null {
  const found = cv.sections[sectionId];
  return found ?? null;
}

/**
 * Look up an item (experience/role/project/etc.) by id. Returns `null` when
 * the id does not exist in any entity store.
 */
export function getItem(
  cv: CvReadModel,
  itemId: ItemId,
  _sectionId?: SectionId,
): CvItem | null {
  const found = cv.items[itemId];
  return found ?? null;
}

/**
 * Read a field slot out of an item using a JSON-Pointer-like field path.
 * Returns `unknown` because templates are expected to narrow with Zod
 * (`someFieldSchema.parse(getField(...))`) rather than `as`.
 */
export function getField(
  cv: CvReadModel,
  itemId: ItemId,
  fieldPath: string,
): unknown {
  const item = cv.items[itemId];
  if (item === undefined) return undefined;
  const segments = parseFieldPath(fieldPath);
  return readPath(item as unknown as Record<string, unknown>, segments);
}

function readPath(
  root: Record<string, unknown>,
  segments: readonly string[],
): unknown {
  let current: unknown = root;
  for (const segment of segments) {
    if (current === null || typeof current !== 'object') return undefined;
    current = (current as Record<string, unknown>)[segment];
    if (current === undefined) return undefined;
  }
  return current;
}
