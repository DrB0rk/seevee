import type { APIRoute } from 'astro';
import { agentErrorResponse, jsonResponse, requireAgentMutation } from '../../../../../lib/agent-http.js';
import { agentRuntimeManager } from '../../../../../lib/agent-runtime.js';

export const prerender = false;

export const POST: APIRoute = async ({ params, request }) => {
  const rejected = requireAgentMutation(request);
  if (rejected !== null) return rejected;
  const sessionId = params['id'];
  if (sessionId === undefined) return jsonResponse({ ok: false, reason: 'missing session id' }, 400);
  try {
    await (await agentRuntimeManager()).interrupt(sessionId);
    return jsonResponse({ ok: true });
  } catch (error) {
    return agentErrorResponse(error);
  }
};
