/**
 * GET /api/cv/:id — fetch a single CV document.
 *
 * The dashboard's right inspector and left rail both anchor to this
 * endpoint. The path parameter must be a CV identifier that the workspace
 * index actually declares; otherwise we return 404 (not 400) so callers
 * can distinguish "no such CV" from "found a CV but its file is invalid".
 */
import type { APIRoute } from 'astro';
import { loadCv, loadWorkspaceContext } from '../../../lib/workspace.js';

export const prerender = false;

export const GET: APIRoute = async ({ params }) => {
  const id = params['id'];
  if (id === undefined || id.length === 0) {
    return jsonResponse({ ok: false, reason: 'missing id' }, 400);
  }
  const ctx = await loadWorkspaceContext();
  const entry = ctx.workspace.data.resources.cvs[id];
  if (entry === undefined) {
    return jsonResponse({ ok: false, reason: `cv ${id} not declared` }, 404);
  }
  const result = await loadCv(ctx.root, entry.relativePath);
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