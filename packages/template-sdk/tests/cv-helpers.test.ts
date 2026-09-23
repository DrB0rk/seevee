import { describe, it, expect } from 'vitest';
import { deriveCv, getSection, getItem, getField } from '../src/cv-helpers.js';
import { parseFieldPath } from '../src/field-path.js';
import type { CvDocument, SectionId, ItemId } from '../src/types.js';

// A minimal but schema-shaped CV document used as a fixture for read-model
// helpers. We construct the object literally here because the SDK's job is
// to interact with the schema types, not to re-parse user input.
function makeCvFixture(): CvDocument {
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
        id: 'identity-default',
        name: { display: 'Avery Designer', pronunciation: 'AY-vree' },
        contact: [{ kind: 'email', value: 'avery@example.test' }],
        pronouns: 'they/them',
      },
      sectionOrder: ['summary-main', 'experience-main'],
      sections: {
        'summary-main': {
          id: 'summary-main',
          type: 'summary',
          title: 'Summary',
          visible: true,
          collapsible: false,
          defaultCollapsed: false,
        },
        'experience-main': {
          id: 'experience-main',
          type: 'experience',
          title: 'Experience',
          visible: true,
          collapsible: true,
          defaultCollapsed: false,
        },
      },
      entities: {
        experience: {
          'experience-acme': {
            id: 'experience-acme',
            type: 'experience',
            organization: {
              id: 'org-acme',
              type: 'organization',
              name: 'Acme Co',
            },
            role: {
              id: 'role-senior-engineer',
              type: 'role',
              title: 'Senior Engineer',
              level: 'IC4',
            },
            period: {
              start: { precision: 'year', year: 2021 },
              end: { precision: 'year', year: 2024 },
            },
            bulletOrder: [],
            bullets: {},
            technologyRefs: [],
          },
        },
        roles: {
          'role-senior-engineer': {
            id: 'role-senior-engineer',
            type: 'role',
            title: 'Senior Engineer',
            level: 'IC4',
          },
        },
      },
    },
  };
}

const SUMMARY: SectionId = 'summary-main' as SectionId;
const ROLE: ItemId = 'role-senior-engineer' as ItemId;

describe('deriveCv + getSection', () => {
  it('returns the section when the id exists', () => {
    const cv = deriveCv(makeCvFixture());
    const section = getSection(cv, SUMMARY);
    expect(section).not.toBeNull();
    expect(section?.title).toBe('Summary');
  });

  it('returns null for an unknown section id', () => {
    const cv = deriveCv(makeCvFixture());
    expect(getSection(cv, 'unknown-section' as SectionId)).toBeNull();
  });
});

describe('deriveCv + getItem', () => {
  it('returns the role item when the id exists', () => {
    const cv = deriveCv(makeCvFixture());
    const item = getItem(cv, ROLE);
    expect(item).not.toBeNull();
    expect(item?.type).toBe('role');
  });

  it('returns null for an unknown item id', () => {
    const cv = deriveCv(makeCvFixture());
    expect(getItem(cv, 'unknown-item' as ItemId)).toBeNull();
  });
});

describe('deriveCv + getField', () => {
  it('reads a nested string field via a path', () => {
    const cv = deriveCv(makeCvFixture());
    const title = getField(cv, ROLE, '/title');
    expect(title).toBe('Senior Engineer');
  });

  it('returns undefined for unknown item ids', () => {
    const cv = deriveCv(makeCvFixture());
    expect(getField(cv, 'unknown-item' as ItemId, '/title')).toBeUndefined();
  });
});

describe('deriveCv invariants', () => {
  it('returns a frozen model so templates cannot mutate it', () => {
    const cv = deriveCv(makeCvFixture());
    expect(Object.isFrozen(cv)).toBe(true);
  });

  it('preserves sectionOrder as an immutable array', () => {
    const cv = deriveCv(makeCvFixture());
    expect([...cv.sectionOrder]).toEqual(['summary-main', 'experience-main']);
  });
});

// Touch parseFieldPath so this file verifies both utilities work together.
describe('getField + parseFieldPath integration', () => {
  it('reads the same path that parseFieldPath produces', () => {
    const cv = deriveCv(makeCvFixture());
    const segments = parseFieldPath('/title');
    expect(segments).toEqual(['title']);
    const value = getField(cv, ROLE, `/${segments.join('/')}`);
    expect(value).toBe('Senior Engineer');
  });
});
