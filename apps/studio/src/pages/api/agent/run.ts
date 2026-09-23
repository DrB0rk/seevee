/**
 * POST /api/agent/run — trigger an agent run.
 *
 * Stub. Validates the body shape, broadcasts `agent.run.started`, and
 * returns the synthesised run id without delegating to
 * `@seevee/agent-runtime` (which is not yet scaffolded).
 */
import type { APIRoute } from 'astro';
import { z } from 'zod';
import { loadWorkspaceContext } from '../../../lib/workspace.js';
import { workspaceWatcher } from '../../../lib/runtime.js';
import { startAgentRun } from '../../../lib/agent-runner.js';

export const prerender = false;

const bodySchema = z.object({
  cvId: z.string().min(1),
  prompt: z.string().min(1).max(8_000),
});

export const POST: APIRoute = async ({ request }) => {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ ok: false, reason: 'invalid JSON body' }, 400);
  }
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return jsonResponse({ ok: false, reason: 'invalid body', issues: parsed.error.issues }, 400);
  }
  const ctx = await loadWorkspaceContext();
  if (ctx.workspace.data.resources.cvs[parsed.data.cvId] === undefined) {
    return jsonResponse({ ok: false, reason: `cv ${parsed.data.cvId} not declared` }, 404);
  }
  const watcher = await workspaceWatcher();
  const handle = startAgentRun(
    {
      workspaceId: ctx.workspace.id,
      cvId: parsed.data.cvId,
      prompt: parsed.data.prompt,
    },
    watcher,
  );
  return jsonResponse({ ok: true, runId: handle.runId, startedAt: handle.startedAt }, 202);
};

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}