/**
 * GET /api/comments/:id — fetch a single comments document.
 */
import type { APIRoute } from 'astro';
import { loadComments, loadWorkspaceContext } from '../../../lib/workspace.js';

export const prerender = false;

export const GET: APIRoute = async ({ params }) => {
  const id = params['id'];
  if (id === undefined || id.length === 0) {
    return jsonResponse({ ok: false, reason: 'missing id' }, 400);
  }
  const ctx = await loadWorkspaceContext();
  const entry = ctx.workspace.data.resources.comments[id];
  if (entry === undefined) {
    return jsonResponse({ ok: false, reason: `comments ${id} not declared` }, 404);
  }
  const result = await loadComments(ctx.root, entry.relativePath);
  if (!result.ok) {
    return jsonResponse({ ok: false, reason: result.reason, issues: result.issues }, result.status);
  }
  return jsonResponse({ ok: true, document: result.document }, 200);
};

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}