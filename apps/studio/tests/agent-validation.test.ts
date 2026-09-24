import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { validateAgentWorkspace } from '../src/lib/agent-validation.js';

const fixtureRoot = fileURLToPath(new URL('./fixtures/workspace', import.meta.url));

describe('agent workspace validation', () => {
  it('validates registered fixture resources and semantics', async () => {
    const result = await validateAgentWorkspace(fixtureRoot);
    expect(result.status).toBe('passed');
    expect(result.checked).toBeGreaterThan(0);
    expect(result.failures).toEqual([]);
  });
});
