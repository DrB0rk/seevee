/**
 * GET /api/render/inspect — surface layout diagnostics for a presentation.
 */
import type { APIRoute } from 'astro';
import {
  loadPresentation,
  loadWorkspaceContext,
} from '../../../lib/workspace.js';
import { inspectPresentation } from '../../../lib/renderer.js';

export const prerender = false;

export const GET: APIRoute = async ({ url }) => {
  const presentationId = url.searchParams.get('presentationId');
  if (presentationId === null || presentationId.length === 0) {
    return jsonResponse({ ok: false, reason: 'missing presentationId' }, 400);
  }
  const ctx = await loadWorkspaceContext();
  const entry = ctx.workspace.data.resources.presentations[presentationId];
  if (entry === undefined) {
    return jsonResponse({ ok: false, reason: `presentation ${presentationId} not declared` }, 404);
  }
  const loaded = await loadPresentation(ctx.root, entry.relativePath);
  if (!loaded.ok) {
    return jsonResponse({ ok: false, reason: loaded.reason, issues: loaded.issues }, loaded.status);
  }
  const inspect = inspectPresentation({ presentation: loaded.document });
  return jsonResponse({ ok: true, presentationId, inspect }, 200);
};

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}