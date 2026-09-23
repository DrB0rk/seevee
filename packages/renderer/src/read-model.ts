// Read-model construction. The renderer does not re-implement the SDK's
// `deriveCv` — that helper already produces the section/item maps templates
// consume. The renderer adds a paginator-specific projection: a flat list
// of "items" with the height estimate and break-behavior metadata needed
// to lay out pages.
//
// The items list walks `cv.sectionOrder`, then for every visible section
// either uses `section.nodeOrder` (when present) or falls back to a
// deterministic iteration over the matching entity store. Items carry
// enough information for the HTML renderer to attach the correct
// `data-seevee-*` anchors.

import type {
  CvDocument,
  CvEntity,
  Section,
} from '@seevee/schema';
import {
  aggregateDiagnostics,
  deriveCv,
  getItem,
  type CvReadModel,
  type CvSection,
  type ItemId,
  type SectionId,
} from '@seevee/template-sdk';

import { estimateItemHeightMm } from './measurement.js';

/**
 * Break behavior for a single content block. The schema exposes these
 * as strings (`'avoid' | 'split' | 'page-before' | 'page-after'`); the
 * renderer pins them to a runtime tuple so consumers get autocomplete
 * and the type never drifts.
 */
export type BreakBehavior =
  | 'avoid'
  | 'split'
  | 'page-before'
  | 'page-after'
  | 'auto';

export interface PaginatorItem {
  readonly id: ItemId;
  readonly sectionId: SectionId;
  readonly kind: 'identity' | 'section-heading' | 'entity' | 'divider';
  readonly entityType: CvEntity['type'] | null;
  readonly heightMm: number;
  readonly breakBehavior: BreakBehavior;
  readonly entity: CvEntity | null;
  readonly section: CvSection;
}

export interface BuildReadModelOptions {
  readonly breakBehavior?: BreakBehavior;
}

const DEFAULT_BREAK: BreakBehavior = 'auto';
const HEADING_SUFFIX = '__heading';
const DIVIDER_SUFFIX = '__divider';

// Mapping from the schema's `Section.type` enum to the entity-store key
// that holds the matching items. The mapping is one-way — a section of
// type `summary` has no store, so we list `null` to make that explicit.
// We only enumerate the section types the schema actually defines.
const SECTION_TYPE_TO_STORE_KEY: Readonly<Record<Section['type'], string | null>> = {
  summary: null,
  experience: 'experience',
  education: 'education',
  projects: 'projects',
  skills: 'skills',
  certifications: 'certifications',
  awards: 'awards',
  languages: 'languages',
  publications: 'publications',
  volunteering: 'volunteering',
  references: 'references',
  // The schema has no `skillGroups` section type today; route the
  // generic `custom` type to its store so a custom-type section still
  // surfaces items.
  custom: 'custom',
};

/**
 * Build a renderable read model from a CV document. The returned
 * `items` array is what the paginator consumes. `cv` is the SDK read
 * model, exposed so the HTML renderer can call `getItem`/`getField`
 * without re-deriving.
 */
export function buildReadModel(
  document: CvDocument,
  options: BuildReadModelOptions = {},
): {
  readonly cv: CvReadModel;
  readonly items: readonly PaginatorItem[];
} {
  const cv = deriveCv(document);
  const defaultBreak = options.breakBehavior ?? DEFAULT_BREAK;
  const items: PaginatorItem[] = [];

  for (const sectionId of cv.sectionOrder) {
    const section = cv.sections[sectionId];
    if (section === undefined || !section.visible) continue;

    items.push({
      id: `${sectionId}${HEADING_SUFFIX}` as ItemId,
      sectionId,
      kind: 'section-heading',
      entityType: null,
      heightMm: estimateItemHeightMm({ kind: 'section-heading', entityType: null }),
      breakBehavior: 'page-before',
      entity: null,
      section,
    });

    const childBreak = options.breakBehavior ?? defaultBreak;

    for (const itemId of entityOrderFor(section, cv)) {
      const entity = getItem(cv, itemId);
      if (entity === null) continue;
      items.push({
        id: itemId,
        sectionId,
        kind: 'entity',
        entityType: entity.type,
        heightMm: estimateItemHeightMm({
          kind: 'entity',
          entityType: entity.type,
          entity,
        }),
        breakBehavior: childBreak,
        entity,
        section,
      });
    }

    items.push({
      id: `${sectionId}${DIVIDER_SUFFIX}` as ItemId,
      sectionId,
      kind: 'divider',
      entityType: null,
      heightMm: estimateItemHeightMm({ kind: 'divider', entityType: null }),
      breakBehavior: 'auto',
      entity: null,
      section,
    });
  }

  return { cv, items: Object.freeze(items) };
}

function entityOrderFor(
  section: Section,
  cv: CvReadModel,
): readonly ItemId[] {
  if (section.nodeOrder !== undefined && section.nodeOrder.length > 0) {
    return section.nodeOrder.map((id) => id as ItemId);
  }

  const storeKey = SECTION_TYPE_TO_STORE_KEY[section.type];
  if (storeKey === null) {
    return [];
  }

  const stores = cv.document.data.entities as unknown as Record<
    string,
    Readonly<Record<string, CvEntity>> | undefined
  >;
  const store = stores[storeKey];
  if (store === undefined) {
    return [];
  }
  return Object.keys(store).map((id) => id as ItemId);
}

// Re-export the diagnostics helper so callers can build the aggregate
// diagnostics from page-level records without reaching into the SDK.
export { aggregateDiagnostics };
