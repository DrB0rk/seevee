/**
 * Error surfacing for agent session mutations.
 *
 * The permissions picker and the Stop button both report success/failure from
 * the HTTP status and body, so a provider rejection must reach the client as
 * an actionable, typed error rather than a generic 500.
 */
import { describe, expect, it } from 'vitest';
import { AgentRuntimeError, OmpProtocolError } from '@seevee/agent-runtime';
import { agentErrorResponse } from '../src/lib/agent-http.js';

async function body(response: Response): Promise<{ ok: boolean; code?: string; provider?: string; reason?: string }> {
  return await response.json() as { ok: boolean; code?: string; provider?: string; reason?: string };
}

describe('agentErrorResponse', () => {
  it('reports a missing session as 404 with a runtime code', async () => {
    const response = agentErrorResponse(new AgentRuntimeError('AGENT_SESSION_NOT_FOUND', 'no such session'));
    expect(response.status).toBe(404);
    expect(await body(response)).toMatchObject({ ok: false, code: 'AGENT_SESSION_NOT_FOUND' });
  });

  it('reports a rejected permission mode as an actionable conflict, not a 500', async () => {
    // The exact failure omp 18.6.1 returns for an unsupported ACP mode.
    const failure = new OmpProtocolError(
      'session/set_mode',
      'full',
      'Unsupported ACP mode: full',
    );
    const response = agentErrorResponse(failure);

    expect(response.status).toBe(409);
    const payload = await body(response);
    expect(payload).toMatchObject({
      ok: false,
      code: 'AGENT_PROVIDER_UNSUPPORTED',
      provider: 'omp',
    });
    expect(payload.reason).toContain('Unsupported ACP mode: full');
    // The client must never see the provider's opaque wording.
    expect(payload.reason).not.toBe('Internal error');
  });

  it('keeps unexpected failures on the generic 500 path', async () => {
    const response = agentErrorResponse(new Error('kaboom'));
    expect(response.status).toBe(500);
    expect(await body(response)).toMatchObject({ ok: false, code: 'AGENT_OPERATION_FAILED', reason: 'kaboom' });
  });

  it('does not mistake an unrelated error for a provider protocol failure', async () => {
    const response = agentErrorResponse(new TypeError('bad type'));
    expect(response.status).toBe(500);
    expect(await body(response)).toMatchObject({ code: 'AGENT_OPERATION_FAILED' });
  });
});