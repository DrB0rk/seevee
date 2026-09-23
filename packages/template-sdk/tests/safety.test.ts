import { describe, it, expect } from 'vitest';
import {
  REJECTED_NODE_BUILTINS,
  REJECTED_GLOBALS,
  assertSafeSdk,
  isUnsafeImport,
} from '../src/safety.js';

describe('safety policy', () => {
  it('lists every required forbidden node module', () => {
    expect(REJECTED_NODE_BUILTINS).toContain('node:fs');
    expect(REJECTED_NODE_BUILTINS).toContain('node:child_process');
    expect(REJECTED_NODE_BUILTINS).toContain('node:net');
    expect(REJECTED_NODE_BUILTINS).toContain('node:http');
    expect(REJECTED_NODE_BUILTINS).toContain('node:https');
  });

  it('lists every required forbidden global', () => {
    expect(REJECTED_GLOBALS).toContain('process');
    expect(REJECTED_GLOBALS).toContain('eval');
    expect(REJECTED_GLOBALS).toContain('Function');
    expect(REJECTED_GLOBALS).toContain('Buffer');
  });

  it('isUnsafeImport catches node:fs and process', () => {
    expect(isUnsafeImport('node:fs')).toBe(true);
    expect(isUnsafeImport('process')).toBe(true);
    expect(isUnsafeImport('eval')).toBe(true);
    expect(isUnsafeImport('Function')).toBe(true);
  });

  it('isUnsafeImport leaves safe specifiers alone', () => {
    expect(isUnsafeImport('zod')).toBe(false);
    expect(isUnsafeImport('@seevee/schema')).toBe(false);
    expect(isUnsafeImport('astro/jsx-runtime')).toBe(false);
  });

  it('assertSafeSdk is a callable no-op that does not throw', () => {
    expect(() => assertSafeSdk()).not.toThrow();
  });
});
