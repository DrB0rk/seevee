import type { APIRoute } from 'astro';
import { promptAgentSchema } from '@seevee/agent-runtime';
import { agentErrorResponse, jsonResponse, requireAgentMutation } from '../../../../../lib/agent-http.js';
import { agentRuntimeManager } from '../../../../../lib/agent-runtime.js';

export const prerender = false;

export const POST: APIRoute = async ({ params, request }) => {
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
  const parsed = promptAgentSchema.safeParse(body);
  if (!parsed.success) return jsonResponse({ ok: false, reason: 'invalid prompt', issues: parsed.error.issues }, 400);
  try {
    const result = await (await agentRuntimeManager()).sendPrompt(sessionId, parsed.data);
    return jsonResponse({ ok: true, ...result }, 202);
  } catch (error) {
    return agentErrorResponse(error);
  }
};
