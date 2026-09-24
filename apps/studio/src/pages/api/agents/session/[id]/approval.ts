import type { APIRoute } from 'astro';
import { resolveAgentApprovalSchema } from '@seevee/agent-runtime';
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
  const parsed = resolveAgentApprovalSchema.safeParse(body);
  if (!parsed.success) return jsonResponse({ ok: false, reason: 'invalid approval response', issues: parsed.error.issues }, 400);
  try {
    await (await agentRuntimeManager()).resolveApproval(sessionId, parsed.data);
    return jsonResponse({ ok: true });
  } catch (error) {
    return agentErrorResponse(error);
  }
};
