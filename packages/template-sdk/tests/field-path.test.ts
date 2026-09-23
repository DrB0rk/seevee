import { describe, it, expect } from 'vitest';
import { parseFieldPath, formatFieldPath } from '../src/field-path.js';

describe('parseFieldPath', () => {
  it('splits a trimmed path on slashes', () => {
    expect(parseFieldPath('  /role/title ')).toEqual(['role', 'title']);
  });

  it('decodes ~1 to / and ~0 to ~', () => {
    expect(parseFieldPath('/a~1b/c~0d')).toEqual(['a/b', 'c~d']);
  });

  it('rejects an empty path', () => {
    expect(() => parseFieldPath('')).toThrow(/cannot be empty/);
  });

  it('rejects a path without a leading slash', () => {
    expect(() => parseFieldPath('role/title')).toThrow(/must start with/);
  });

  it('rejects an empty segment between slashes', () => {
    expect(() => parseFieldPath('/a//c')).toThrow();
  });

  it('rejects an invalid ~ escape (not ~0 or ~1)', () => {
    expect(() => parseFieldPath('/a~2b')).toThrow();
  });
});

describe('formatFieldPath', () => {
  it('escapes ~ to ~0 and / to ~1', () => {
    expect(formatFieldPath(['a/b', 'c~d'])).toBe('/a~1b/c~0d');
  });

  it('round-trips through parseFieldPath', () => {
    const segments = ['role', 'title'];
    expect(parseFieldPath(formatFieldPath(segments))).toEqual(segments);
  });

  it('rejects empty segment lists', () => {
    expect(() => formatFieldPath([])).toThrow(/at least one segment/);
  });

  it('rejects empty individual segments', () => {
    expect(() => formatFieldPath(['role', ''])).toThrow(/cannot be empty/);
  });
});
