/**
 * POST /api/export/pdf — generate a PDF for a presentation.
 *
 * Stub. Returns a structured 501 with a clear pointer to the planned
 * Playwright-based export path. The dashboard's PDF button should disable
 * itself on this response or surface the explanatory message.
 */
import type { APIRoute } from 'astro';
import { z } from 'zod';
import {
  loadPresentation,
  loadWorkspaceContext,
} from '../../../lib/workspace.js';
import { workspaceWatcher } from '../../../lib/runtime.js';

export const prerender = false;

const bodySchema = z.object({
  presentationId: z.string().min(1),
  forceOverflow: z.boolean().optional(),
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
  const entry = ctx.workspace.data.resources.presentations[parsed.data.presentationId];
  if (entry === undefined) {
    return jsonResponse({ ok: false, reason: 'presentation not declared' }, 404);
  }
  const loaded = await loadPresentation(ctx.root, entry.relativePath);
  if (!loaded.ok) {
    return jsonResponse({ ok: false, reason: loaded.reason, issues: loaded.issues }, loaded.status);
  }
  const watcher = await workspaceWatcher();
  watcher.broadcast({ type: 'export.completed', exportId: `export_${Date.now()}` });
  return jsonResponse(
    {
      ok: false,
      reason: 'pdf export not implemented — Playwright renderer lands in P2',
      presentationId: parsed.data.presentationId,
    },
    501,
  );
};

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}