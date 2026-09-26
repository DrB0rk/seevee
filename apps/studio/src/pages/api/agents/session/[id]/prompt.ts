import type { APIRoute } from 'astro';
import { promptAgentSchema } from '@seevee/agent-runtime';
import { agentErrorResponse, jsonResponse, requireAgentMutation } from '../../../../../lib/agent-http.js';
import { agentRuntimeManager } from '../../../../../lib/agent-runtime.js';
import { recordAgentSessionPrompt } from '../../../../../lib/agent-session-index.js';
import { loadWorkspaceContext } from '../../../../../lib/workspace.js';
import { buildAgentPromptContext } from '../../../../../lib/agent-prompt-context.js';

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
    const manager = await agentRuntimeManager();
    const workspace = await loadWorkspaceContext();
    const promptContext = await buildAgentPromptContext(workspace);
    const result = await manager.sendPrompt(sessionId, {
      ...parsed.data,
      text: `${parsed.data.text}\n\n${promptContext}`,
      displayText: parsed.data.displayText ?? parsed.data.text,
    });
    // Persist the prompt immediately: the provider reports only agent output,
    // so this is the only record of what the user actually asked.
    const session = manager.snapshot().sessions.find((item) => item.id === sessionId);
    if (session !== undefined) {
      await recordAgentSessionPrompt(workspace.root, session, {
        id: parsed.data.promptId ?? `prompt-${Date.now().toString(36)}`,
        text: parsed.data.displayText ?? parsed.data.text,
        createdAt: new Date().toISOString(),
      });
    }
    return jsonResponse({ ok: true, ...result }, 202);
  } catch (error) {
    return agentErrorResponse(error);
  }
};
