import type { APIRoute } from 'astro';
import { agentErrorResponse, jsonResponse } from '../../../../../lib/agent-http.js';
import { agentRuntimeManager } from '../../../../../lib/agent-runtime.js';

export const prerender = false;

export const GET: APIRoute = async ({ params }) => {
  const sessionId = params['id'];
  if (sessionId === undefined) return jsonResponse({ ok: false, reason: 'missing session id' }, 400);
  try {
    const configuration = await (await agentRuntimeManager()).getSessionConfiguration(sessionId);
    return jsonResponse({ ok: true, configuration });
  } catch (error) {
    return agentErrorResponse(error);
  }
};
