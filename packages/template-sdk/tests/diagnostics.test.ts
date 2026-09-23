import { describe, it, expect } from 'vitest';
import {
  evaluatePageLayout,
  aggregateDiagnostics,
  contentBoxMm,
  hasOverflow,
  type PageContent,
} from '../src/diagnostics.js';
import type { PageDiagnostic, PageProfile } from '../src/types.js';

const a4Portrait: PageProfile = {
  preset: 'A4',
  orientation: 'portrait',
  edges: { top: 20, right: 20, bottom: 20, left: 20 },
};

describe('evaluatePageLayout', () => {
  it('returns overflow=false when content fits the A4 content box', () => {
    const page: PageContent = {
      pageNumber: 1,
      itemIds: ['role-senior-engineer' as never],
      contentHeightMm: 200,
    };
    const result = evaluatePageLayout(page, a4Portrait);
    expect(result.overflow).toBe(false);
    expect(result.overflowAmount).toBe(0);
    expect(result.clippedNodes).toEqual([]);
    expect(result.blankPage).toBe(false);
    expect(result.pageNumber).toBe(1);
  });

  it('flags overflow and reports the positive delta in mm', () => {
    const box = contentBoxMm(a4Portrait);
    const overflowing: PageContent = {
      pageNumber: 2,
      itemIds: ['role-senior-engineer' as never],
      contentHeightMm: box.height + 12,
    };
    const result = evaluatePageLayout(overflowing, a4Portrait);
    expect(result.overflow).toBe(true);
    expect(result.overflowAmount).toBe(12);
  });

  it('treats a page with no items as blank', () => {
    const blank: PageContent = { pageNumber: 3, itemIds: [], contentHeightMm: 0 };
    const result = evaluatePageLayout(blank, a4Portrait);
    expect(result.blankPage).toBe(true);
  });

  it('reports clipped item ids from the per-item overflow map', () => {
    const page: PageContent = {
      pageNumber: 1,
      itemIds: ['role-a' as never, 'role-b' as never],
      contentHeightMm: 50,
      itemOverflowMm: { 'role-a': 0, 'role-b': 4 },
    };
    const result = evaluatePageLayout(page, a4Portrait);
    expect(result.clippedNodes).toEqual(['role-b']);
  });
});

describe('aggregateDiagnostics', () => {
  it('totals overflow amounts across pages', () => {
    const pages: PageDiagnostic[] = [
      Object.freeze({
        pageNumber: 1,
        overflow: false,
        overflowAmount: 0,
        clippedNodes: [],
        blankPage: false,
      }),
      Object.freeze({
        pageNumber: 2,
        overflow: true,
        overflowAmount: 5,
        clippedNodes: ['role-b' as never],
        blankPage: false,
      }),
      Object.freeze({
        pageNumber: 3,
        overflow: true,
        overflowAmount: 2,
        clippedNodes: [],
        blankPage: true,
      }),
    ];
    const result = aggregateDiagnostics(pages);
    expect(result.totalOverflow).toBe(7);
    expect(result.hasClipping).toBe(true);
    expect(result.hasBlankPages).toBe(true);
  });

  it('deduplicates font substitutions and missing assets, preserving order', () => {
    const pages: PageDiagnostic[] = [];
    const result = aggregateDiagnostics(
      pages,
      ['Inter', 'Helvetica', 'Inter', 'Helvetica Neue'],
      ['logo.svg', 'photo.jpg', 'logo.svg'],
    );
    expect(result.fontSubstitutions).toEqual(['Inter', 'Helvetica', 'Helvetica Neue']);
    expect(result.missingAssets).toEqual(['logo.svg', 'photo.jpg']);
  });
});

describe('hasOverflow', () => {
  it('returns true only when any page exceeded the content box', () => {
    const clean = aggregateDiagnostics([
      Object.freeze({
        pageNumber: 1,
        overflow: false,
        overflowAmount: 0,
        clippedNodes: [],
        blankPage: false,
      }),
    ]);
    expect(hasOverflow(clean)).toBe(false);

    const messy = aggregateDiagnostics([
      Object.freeze({
        pageNumber: 1,
        overflow: true,
        overflowAmount: 0.5,
        clippedNodes: [],
        blankPage: false,
      }),
    ]);
    expect(hasOverflow(messy)).toBe(true);
  });
});
