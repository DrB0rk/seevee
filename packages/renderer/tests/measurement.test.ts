// Measurement tests. The MVP uses fixed per-item-type height constants
// rather than real text measurement. These tests pin those constants
// and confirm the per-entity adjustments line up with the fixture data
// we use in render.test.ts.

import { describe, it, expect } from 'vitest';

import { estimateItemHeightMm, measureOverflow } from '../src/measurement.js';
import type { Experience, Skill } from '@seevee/schema';

describe('estimateItemHeightMm', () => {
  it('returns a stable heading height for section headings', () => {
    expect(
      estimateItemHeightMm({ kind: 'section-heading', entityType: null }),
    ).toBeGreaterThan(0);
  });

  it('returns a small divider height', () => {
    expect(estimateItemHeightMm({ kind: 'divider', entityType: null })).toBe(2);
  });

  it('grows the experience estimate with the number of bullets', () => {
    const small: Experience = {
      id: 'exp_a',
      type: 'experience',
      organization: { id: 'o', type: 'organization', name: 'X' },
      role: { id: 'r', type: 'role', title: 'Y' },
      period: { start: { precision: 'year', year: 2020 } },
      bulletOrder: ['b1'],
      bullets: { b1: { id: 'b1', text: 'x' } },
      technologyRefs: [],
    };
    const big: Experience = {
      ...small,
      bulletOrder: ['b1', 'b2', 'b3', 'b4', 'b5', 'b6'],
      bullets: {
        b1: { id: 'b1', text: 'x' },
        b2: { id: 'b2', text: 'x' },
        b3: { id: 'b3', text: 'x' },
        b4: { id: 'b4', text: 'x' },
        b5: { id: 'b5', text: 'x' },
        b6: { id: 'b6', text: 'x' },
      },
    };
    const smallHeight = estimateItemHeightMm({
      kind: 'entity',
      entityType: 'experience',
      entity: small,
    });
    const bigHeight = estimateItemHeightMm({
      kind: 'entity',
      entityType: 'experience',
      entity: big,
    });
    expect(bigHeight).toBeGreaterThan(smallHeight);
  });

  it('keeps skill height proportional to its keywords', () => {
    const baseSkill: Skill = {
      id: 'skl',
      type: 'skill',
      name: 'TypeScript',
      keywords: [],
    };
    const tallSkill: Skill = { ...baseSkill, keywords: ['a', 'b', 'c', 'd'] };
    const base = estimateItemHeightMm({
      kind: 'entity',
      entityType: 'skill',
      entity: baseSkill,
    });
    const tall = estimateItemHeightMm({
      kind: 'entity',
      entityType: 'skill',
      entity: tallSkill,
    });
    expect(tall).toBe(base);
  });
});

describe('measureOverflow', () => {
  it('reports zero overflow when items fit', () => {
    const items = [{ heightMm: 50 }, { heightMm: 50 }];
    expect(measureOverflow(items, 200)).toEqual({
      pageHeight: 100,
      overflowAmount: 0,
      fits: true,
    });
  });

  it('reports a positive overflow when items exceed the page', () => {
    const items = [{ heightMm: 80 }, { heightMm: 80 }, { heightMm: 80 }];
    const result = measureOverflow(items, 200);
    expect(result.pageHeight).toBe(240);
    expect(result.overflowAmount).toBe(40);
    expect(result.fits).toBe(false);
  });

  it('clamps negative overflow to zero', () => {
    const result = measureOverflow([{ heightMm: 10 }], 200);
    expect(result.overflowAmount).toBe(0);
  });
});
