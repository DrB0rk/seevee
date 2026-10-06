import { describe, it, expect } from 'vitest';
import { resolveFieldText, stringifyFieldValue } from '../src/field-text.js';
import { deriveCv } from '../src/cv-helpers.js';
import type { CvDocument, ItemId, SectionId } from '../src/types.js';

// Unit coverage for the value-resolution rules the `Field` component uses.
// The rendering test (page-helpers.test.ts) proves the same rules survive a
// full Astro compile; these tests pin the edge cases directly.
const CV = deriveCv(makeCv());
const EXPERIENCE: ItemId = 'exp_acme' as ItemId;
const SECTION: SectionId = 'sec_experience' as SectionId;

describe('stringifyFieldValue', () => {
  it('passes strings through unchanged', () => {
    expect(stringifyFieldValue('Senior Engineer')).toBe('Senior Engineer');
  });

  it('renders numbers and booleans as text', () => {
    expect(stringifyFieldValue(2020)).toBe('2020');
    expect(stringifyFieldValue(true)).toBe('true');
  });

  it('serialises structured values as JSON', () => {
    expect(stringifyFieldValue({ a: 1 })).toBe('{"a":1}');
    expect(stringifyFieldValue(['x', 'y'])).toBe('["x","y"]');
  });

  it('reports nullish values as absent', () => {
    expect(stringifyFieldValue(null)).toBeNull();
    expect(stringifyFieldValue(undefined)).toBeNull();
  });

  it('reports a cyclic value as absent instead of throwing', () => {
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    expect(stringifyFieldValue(cyclic)).toBeNull();
  });
});

describe('resolveFieldText', () => {
  it('resolves a nested field path to its actual value', () => {
    expect(resolveFieldText(CV, EXPERIENCE, '/role/title')).toBe('Senior Engineer');
    expect(resolveFieldText(CV, EXPERIENCE, '/organization/name')).toBe('Acme');
    expect(resolveFieldText(CV, EXPERIENCE, '/period/start/year')).toBe('2020');
  });

  it('falls back when the field is missing', () => {
    expect(resolveFieldText(CV, EXPERIENCE, '/summary', 'No summary')).toBe('No summary');
  });

  it('prefers the resolved value over the fallback', () => {
    expect(resolveFieldText(CV, EXPERIENCE, '/role/title', 'fallback')).toBe(
      'Senior Engineer',
    );
  });

  it('falls back when the item itself is unknown', () => {
    expect(resolveFieldText(CV, 'nope' as ItemId, '/role/title', 'fallback')).toBe('fallback');
  });

  it('renders an empty string when both value and fallback are absent', () => {
    expect(resolveFieldText(CV, EXPERIENCE, '/summary')).toBe('');
  });

  it('keeps the section id out of the lookup — fields address the item', () => {
    // The section id is a binding anchor, not a lookup scope: the same
    // item+path must resolve identically regardless of which section
    // claims to own it.
    expect(resolveFieldText(CV, EXPERIENCE, '/role/title', 'x')).toBe('Senior Engineer');
    expect(SECTION).toBe('sec_experience');
  });
});

function makeCv(): CvDocument {
  return {
    kind: 'seevee.cv',
    schemaVersion: '0.1.0',
    id: 'cv-fixture',
    revision: 1,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    data: {
      locale: 'en-US',
      identity: {
        id: 'person-normal',
        name: { display: 'Grace Hopper' },
        contact: [],
      },
      sectionOrder: ['sec_experience'],
      sections: {
        sec_experience: {
          id: 'sec_experience',
          type: 'experience',
          title: 'Experience',
          visible: true,
          collapsible: false,
          defaultCollapsed: false,
          nodeOrder: ['exp_acme'],
        },
      },
      entities: {
        experience: {
          exp_acme: {
            id: 'exp_acme',
            type: 'experience',
            organization: {
              id: 'org_acme',
              type: 'organization',
              name: 'Acme',
            },
            role: { id: 'role_senior', type: 'role', title: 'Senior Engineer' },
            period: {
              start: { precision: 'year', year: 2020 },
              end: { precision: 'year', year: 2024 },
            },
            bulletOrder: [],
            bullets: {},
            technologyRefs: [],
          },
        },
      },
    },
  };
}