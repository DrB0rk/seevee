import type { APIRoute } from 'astro';
import { updateAgentSessionSchema } from '@seevee/agent-runtime';
import { agentErrorResponse, jsonResponse, requireAgentMutation } from '../../../../lib/agent-http.js';
import { agentRuntimeManager } from '../../../../lib/agent-runtime.js';
import { persistAgentSession } from '../../../../lib/agent-session-index.js';
import { loadWorkspaceContext } from '../../../../lib/workspace.js';

export const prerender = false;

export const PATCH: APIRoute = async ({ params, request }) => {
  const rejected = requireAgentMutation(request);
  if (rejected !== null) return rejected;
  const sessionId = params['id'];
  if (sessionId === undefined) return jsonResponse({ ok: false, reason: 'missing session id' }, 400);
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ ok: false, reason: 'invalid JSON body' }, 400);
  }
  const parsed = updateAgentSessionSchema.safeParse(body);
  if (!parsed.success) return jsonResponse({ ok: false, reason: 'invalid session update', issues: parsed.error.issues }, 400);
  try {
    const session = await (await agentRuntimeManager()).updateSession(sessionId, parsed.data);
    return jsonResponse({ ok: true, session });
  } catch (error) {
    return agentErrorResponse(error);
  }
};

export const DELETE: APIRoute = async ({ params, request }) => {
  const rejected = requireAgentMutation(request);
  if (rejected !== null) return rejected;
  const sessionId = params['id'];
  if (sessionId === undefined) return jsonResponse({ ok: false, reason: 'missing session id' }, 400);
  try {
    const manager = await agentRuntimeManager();
    const session = manager.snapshot().sessions.find((item) => item.id === sessionId);
    if (session !== undefined && session.state !== 'idle' && session.state !== 'starting') {
      await persistAgentSession((await loadWorkspaceContext()).root, { ...session, state: 'closed' });
    }
    await manager.closeSession(sessionId);
    return jsonResponse({ ok: true });
  } catch (error) {
    return agentErrorResponse(error);
  }
};
