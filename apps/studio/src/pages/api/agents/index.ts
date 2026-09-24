import type { APIRoute } from 'astro';
import { agentRuntimeManager } from '../../../lib/agent-runtime.js';
import { readAgentSessionIndex } from '../../../lib/agent-session-index.js';
import { loadWorkspaceContext } from '../../../lib/workspace.js';
import { jsonResponse } from '../../../lib/agent-http.js';

export const prerender = false;

export const GET: APIRoute = async ({ url }) => {
  const manager = await agentRuntimeManager();
  await manager.detectProviders(url.searchParams.get('refresh') === '1');
  const context = await loadWorkspaceContext();
  const savedSessions = await readAgentSessionIndex(context.root);
  return jsonResponse({ ok: true, snapshot: manager.snapshot(), savedSessions });
};
