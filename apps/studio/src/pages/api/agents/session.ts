import type { APIRoute } from 'astro';
import { createAgentSessionSchema } from '@seevee/agent-runtime';
import { agentErrorResponse, jsonResponse, requireAgentMutation } from '../../../lib/agent-http.js';
import { agentRuntimeManager } from '../../../lib/agent-runtime.js';
import { loadWorkspaceContext } from '../../../lib/workspace.js';

export const prerender = false;

export const POST: APIRoute = async ({ request }) => {
  const rejected = requireAgentMutation(request);
  if (rejected !== null) return rejected;
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ ok: false, reason: 'invalid JSON body' }, 400);
  }
  const parsed = createAgentSessionSchema.safeParse(body);
  if (!parsed.success) return jsonResponse({ ok: false, reason: 'invalid session request', issues: parsed.error.issues }, 400);
  try {
    const manager = await agentRuntimeManager();
    const workspace = await loadWorkspaceContext();
    const session = await manager.createSession(parsed.data, workspace.root);
    return jsonResponse({ ok: true, session }, 201);
  } catch (error) {
    return agentErrorResponse(error);
  }
};
