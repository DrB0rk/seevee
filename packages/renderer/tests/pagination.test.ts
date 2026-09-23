// Pagination tests. The paginator must respect each item's
// `breakBehavior` and never silently swallow overflow. These tests
// build synthetic item lists and assert on the page boundaries.

import { describe, it, expect } from 'vitest';

import { paginate } from '../src/pagination.js';
import type { PaginatorItem } from '../src/read-model.js';
import type { ItemId, SectionId } from '@seevee/template-sdk';

const SEC: SectionId = 'sec-test' as SectionId;

function makeItem(
  id: string,
  heightMm: number,
  overrides: Partial<PaginatorItem> = {},
): PaginatorItem {
  return {
    id: id as ItemId,
    sectionId: SEC,
    kind: 'entity',
    entityType: 'experience',
    heightMm,
    breakBehavior: 'auto',
    entity: null,
    section: {
      id: SEC,
      type: 'experience',
      title: 'Experience',
      visible: true,
      collapsible: false,
      defaultCollapsed: false,
    },
    ...overrides,
  };
}

describe('paginate', () => {
  it('places a single short item on one page', () => {
    const items = [makeItem('a', 40)];
    const result = paginate(items, { pageHeightMm: 200 });
    expect(result.pages).toHaveLength(1);
    expect(result.pages[0]?.items).toHaveLength(1);
    expect(result.unclippableOverflow).toEqual([]);
  });

  it('emits two pages when content overflows the content box', () => {
    const items = [
      makeItem('a', 80),
      makeItem('b', 80),
      makeItem('c', 80),
    ];
    const result = paginate(items, { pageHeightMm: 150 });
    expect(result.pages.length).toBeGreaterThanOrEqual(2);
    for (const page of result.pages) {
      expect(page.contentHeightMm).toBeLessThanOrEqual(150 + 80);
    }
  });

  it('honours `page-before` by starting the item on a fresh page', () => {
    const items = [
      makeItem('a', 30),
      makeItem('b', 30, { breakBehavior: 'page-before' }),
      makeItem('c', 30),
    ];
    const result = paginate(items, { pageHeightMm: 200 });
    expect(result.pages.length).toBeGreaterThanOrEqual(2);
    const firstPageItemIds = result.pages[0]?.items.map((i) => i.id) ?? [];
    expect(firstPageItemIds).toContain('a');
    expect(firstPageItemIds).not.toContain('b');
  });

  it('honours `page-after` by closing the page after the item', () => {
    const items = [
      makeItem('a', 30, { breakBehavior: 'page-after' }),
      makeItem('b', 30),
    ];
    const result = paginate(items, { pageHeightMm: 200 });
    const firstPageItemIds = result.pages[0]?.items.map((i) => i.id) ?? [];
    expect(firstPageItemIds).toEqual(['a']);
    const secondPageItemIds = result.pages[1]?.items.map((i) => i.id) ?? [];
    expect(secondPageItemIds).toEqual(['b']);
  });

  it('honours `avoid` by moving the item to the next page when it would not fit', () => {
    const items = [
      makeItem('a', 180),
      makeItem('b', 40, { breakBehavior: 'avoid' }),
    ];
    const result = paginate(items, { pageHeightMm: 200 });
    expect(result.pages.length).toBe(2);
    expect(result.pages[0]?.items.map((i) => i.id)).toEqual(['a']);
    expect(result.pages[1]?.items.map((i) => i.id)).toEqual(['b']);
  });

  it('reports overflow when an item cannot fit even on its own page', () => {
    const items = [makeItem('huge', 300)];
    const result = paginate(items, { pageHeightMm: 200 });
    expect(result.unclippableOverflow).toHaveLength(1);
    expect(result.unclippableOverflow[0]?.itemId).toBe('huge');
    expect(result.unclippableOverflow[0]?.overflowAmount).toBe(100);
  });

  it('produces deterministic page boundaries for the same input', () => {
    const items = Array.from({ length: 12 }, (_, i) =>
      makeItem(`item-${i}`, 50),
    );
    const first = paginate(items, { pageHeightMm: 200 });
    const second = paginate(items, { pageHeightMm: 200 });
    expect(first.pages.length).toBe(second.pages.length);
    for (let i = 0; i < first.pages.length; i += 1) {
      const a = first.pages[i];
      const b = second.pages[i];
      expect(a?.pageNumber).toBe(b?.pageNumber);
      expect(a?.items.map((it) => it.id)).toEqual(b?.items.map((it) => it.id));
    }
  });

  it('caps pages at maxPages when supplied', () => {
    const items = Array.from({ length: 200 }, (_, i) =>
      makeItem(`item-${i}`, 80),
    );
    const result = paginate(items, { pageHeightMm: 100, maxPages: 3 });
    expect(result.pages.length).toBeLessThanOrEqual(3);
  });
});
