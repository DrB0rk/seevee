import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  readAgentSessionIndex,
  recordAgentSessionPrompt,
  persistAgentSession,
} from '../src/lib/agent-session-index.js';
import type { AgentSessionSummary } from '@seevee/agent-runtime';

let root = '';

function session(overrides: Partial<AgentSessionSummary> = {}): AgentSessionSummary {
  return {
    id: 'agent-1',
    provider: 'codex',
    externalSessionId: 'ext-1',
    title: 'Codex session',
    state: 'idle',
    model: null,
    createdAt: '2026-09-25T10:00:00.000Z',
    lastActivityAt: '2026-09-25T10:05:00.000Z',
    ...overrides,
  } as AgentSessionSummary;
}

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'seevee-prompts-'));
});

afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

describe('agent prompt history', () => {
  it('stores prompts against the provider session, not the runtime session', async () => {
    await recordAgentSessionPrompt(root, session(), { id: 'p1', text: 'make it blue', createdAt: '2026-09-25T10:01:00.000Z' });
    const [saved] = await readAgentSessionIndex(root);
    expect(saved?.prompts).toEqual([{ id: 'p1', text: 'make it blue', createdAt: '2026-09-25T10:01:00.000Z' }]);
  });

  it('keeps prompts when the session is persisted again at turn end', async () => {
    await recordAgentSessionPrompt(root, session(), { id: 'p1', text: 'first', createdAt: '2026-09-25T10:01:00.000Z' });
    await persistAgentSession(root, session({ state: 'completed', lastActivityAt: '2026-09-25T10:09:00.000Z' }));
    const [saved] = await readAgentSessionIndex(root);
    expect(saved?.state).toBe('completed');
    expect(saved?.prompts.map((prompt) => prompt.text)).toEqual(['first']);
  });

  it('survives a resumed runtime session because the external id is unchanged', async () => {
    await recordAgentSessionPrompt(root, session(), { id: 'p1', text: 'first', createdAt: '2026-09-25T10:01:00.000Z' });
    await recordAgentSessionPrompt(root, session({ id: 'agent-2' }), { id: 'p2', text: 'second', createdAt: '2026-09-25T10:06:00.000Z' });
    const sessions = await readAgentSessionIndex(root);
    expect(sessions).toHaveLength(1);
    expect(sessions[0]?.prompts.map((prompt) => prompt.text)).toEqual(['first', 'second']);
  });

  it('does not duplicate a prompt that is recorded twice', async () => {
    await recordAgentSessionPrompt(root, session(), { id: 'p1', text: 'once', createdAt: '2026-09-25T10:01:00.000Z' });
    await recordAgentSessionPrompt(root, session(), { id: 'p1', text: 'once', createdAt: '2026-09-25T10:01:00.000Z' });
    const [saved] = await readAgentSessionIndex(root);
    expect(saved?.prompts).toHaveLength(1);
  });

  it('reads an index written before prompts were recorded', async () => {
    await fs.mkdir(path.join(root, '.seevee'), { recursive: true });
    await fs.writeFile(path.join(root, '.seevee', 'agent-sessions.json'), JSON.stringify({
      schemaVersion: 1,
      sessions: [{
        id: 'agent-old', provider: 'omp', externalSessionId: 'ext-old', title: 'Old', state: 'idle',
        model: null, createdAt: '2026-09-24T10:00:00.000Z', lastActivityAt: '2026-09-24T10:00:00.000Z',
      }],
    }));
    const sessions = await readAgentSessionIndex(root);
    expect(sessions[0]?.prompts).toEqual([]);
  });

  it('ignores a session the provider has not yet identified', async () => {
    await recordAgentSessionPrompt(root, session({ externalSessionId: null }), { id: 'p1', text: 'x', createdAt: '2026-09-25T10:01:00.000Z' });
    expect(await readAgentSessionIndex(root)).toEqual([]);
  });
});
