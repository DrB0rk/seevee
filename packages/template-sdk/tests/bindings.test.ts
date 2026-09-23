import { describe, it, expect } from 'vitest';
import { bind } from '../src/bindings.js';
import type { ItemId, SectionId } from '../src/types.js';

const SUMMARY: SectionId = 'summary-main' as SectionId;
const EXPERIENCE: SectionId = 'experience-main' as SectionId;
const ROLE_ENGINEER: ItemId = 'role-senior-engineer' as ItemId;
const IDENTITY_BLOCK: ItemId = 'identity-block' as ItemId;

describe('bind.section', () => {
  it('produces the data-seevee-section attribute key with the supplied id', () => {
    const result = bind.section(SUMMARY);
    expect(result).toEqual({ 'data-seevee-section': 'summary-main' });
    expect(Object.keys(result)).toEqual(['data-seevee-section']);
  });

  it('is frozen so templates cannot mutate it', () => {
    const result = bind.section(SUMMARY);
    expect(Object.isFrozen(result)).toBe(true);
  });
});

describe('bind.item', () => {
  it('emits data-seevee-item and data-seevee-section when a section id is supplied', () => {
    const result = bind.item(ROLE_ENGINEER, EXPERIENCE);
    expect(result).toEqual({
      'data-seevee-item': 'role-senior-engineer',
      'data-seevee-section': 'experience-main',
    });
  });

  it('omits the section id for unsectioned items', () => {
    const result = bind.item(IDENTITY_BLOCK);
    expect(result).toEqual({
      'data-seevee-item': 'identity-block',
      'data-seevee-section': '',
    });
  });
});

describe('bind.field', () => {
  it('emits all three data-seevee-* anchors for a field', () => {
    const result = bind.field(ROLE_ENGINEER, EXPERIENCE, '/title');
    expect(result).toEqual({
      'data-seevee-field': '/title',
      'data-seevee-item': 'role-senior-engineer',
      'data-seevee-field-path': '/title',
    });
  });
});
