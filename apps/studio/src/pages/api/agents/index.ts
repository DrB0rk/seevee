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
  // The chat shows which document the agent is working on, so the client does
  // not have to scrape it out of the layout.
  const templates = context.workspace.data.resources.templates;
  const activeDocument = {
    cvId: context.workspace.data.active.cvId,
    presentationId: context.workspace.data.active.presentationId,
    templateVersionId: templates[Object.keys(templates)[0] ?? '']?.currentVersionId ?? null,
  };
  return jsonResponse({ ok: true, snapshot: manager.snapshot(), savedSessions, activeDocument });
};
