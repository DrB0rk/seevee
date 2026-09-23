// Height estimation. Real text measurement is post-MVP; the renderer
// uses fixed millimetre constants keyed off the item type so paginator
// output is stable and the dashboard can reason about overflow before
// the browser-level measurement pipeline ships.
//
// The constants are intentionally conservative: a heading lands at
// 8mm, a paragraph at 4mm, a list-item at 5mm, a divider at 2mm. We
// also fold a per-entity adjustment for entity types that have a lot of
// structured content (experience, education, project) so the dense
// fixture breaks across multiple pages instead of overflowing a single
// page silently.

import type { CvEntity } from '@seevee/schema';

const HEIGHT_BY_KIND_MM = {
  'section-heading': 8,
  identity: 12,
  divider: 2,
} as const;

const ENTITY_BASE_HEIGHT_MM = 6;
const ENTITY_EXTRA_HEIGHT_BY_TYPE = {
  experience: 10,
  education: 8,
  project: 8,
  'bullet-collection': 4,
  'skill-group': 4,
  organization: 4,
  role: 4,
  skill: 3,
  certification: 4,
  award: 3,
  language: 3,
  publication: 5,
  volunteering: 8,
  reference: 4,
  customEntity: 5,
} as const satisfies Record<CvEntity['type'], number>;

const EXPERIENCE_BULLET_HEIGHT_MM = 4;
const EDUCATION_DETAIL_HEIGHT_MM = 3;
const MAX_BULLETS_IN_ESTIMATE = 8;
const MAX_DETAILS_IN_ESTIMATE = 6;

interface ItemInput {
  readonly kind: 'identity' | 'section-heading' | 'entity' | 'divider';
  readonly entityType: CvEntity['type'] | null;
  readonly entity?: CvEntity;
}

/**
 * Estimate the laid-out height (in mm) for a single content item. The
 * estimate is deterministic for a given input — no randomness, no
 * environment lookups — so paginator output is reproducible.
 */
export function estimateItemHeightMm(input: ItemInput): number {
  if (input.kind !== 'entity') {
    return HEIGHT_BY_KIND_MM[input.kind];
  }
  const entity = input.entity;
  if (entity === undefined) {
    return ENTITY_BASE_HEIGHT_MM;
  }
  const base = ENTITY_BASE_HEIGHT_MM + ENTITY_EXTRA_HEIGHT_BY_TYPE[entity.type];
  let extra = 0;
  if (entity.type === 'experience') {
    extra += Math.min(entity.bulletOrder.length, MAX_BULLETS_IN_ESTIMATE) * EXPERIENCE_BULLET_HEIGHT_MM;
  } else if (entity.type === 'education') {
    extra += Math.min(entity.details.length, MAX_DETAILS_IN_ESTIMATE) * EDUCATION_DETAIL_HEIGHT_MM;
  } else if (entity.type === 'project' && entity.bulletOrder !== undefined) {
    extra += Math.min(entity.bulletOrder.length, MAX_BULLETS_IN_ESTIMATE) * EXPERIENCE_BULLET_HEIGHT_MM;
  } else if (entity.type === 'bullet-collection') {
    extra += Math.min(entity.bulletOrder.length, MAX_BULLETS_IN_ESTIMATE) * EXPERIENCE_BULLET_HEIGHT_MM;
  } else if (entity.type === 'skill-group') {
    extra += Math.min(entity.skillRefs.length, MAX_BULLETS_IN_ESTIMATE) * 2;
  }
  return base + extra;
}

/**
 * Estimate the laid-out height of an item id using a precomputed
 * paginator-item list. The function is a thin convenience for callers
 * that already have the model and want a single number back.
 */
export function measureOverflow(
  items: ReadonlyArray<{ readonly heightMm: number }>,
  pageHeightMm: number,
): { readonly pageHeight: number; readonly overflowAmount: number; readonly fits: boolean } {
  const pageHeight = items.reduce((sum, item) => sum + item.heightMm, 0);
  const overflowAmount = Math.max(0, pageHeight - pageHeightMm);
  return {
    pageHeight,
    overflowAmount,
    fits: overflowAmount === 0,
  };
}
