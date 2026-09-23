/**
 * GET /api/presentation/:id — fetch a single presentation document.
 */
import type { APIRoute } from 'astro';
import { loadPresentation, loadWorkspaceContext } from '../../../lib/workspace.js';

export const prerender = false;

export const GET: APIRoute = async ({ params }) => {
  const id = params['id'];
  if (id === undefined || id.length === 0) {
    return new Response(JSON.stringify({ ok: false, reason: 'missing id' }), {
      status: 400,
      headers: { 'content-type': 'application/json; charset=utf-8' },
    });
  }
  const ctx = await loadWorkspaceContext();
  const entry = ctx.workspace.data.resources.presentations[id];
  if (entry === undefined) {
    return new Response(JSON.stringify({ ok: false, reason: `presentation ${id} not declared` }), {
      status: 404,
      headers: { 'content-type': 'application/json; charset=utf-8' },
    });
  }
  const result = await loadPresentation(ctx.root, entry.relativePath);
  if (!result.ok) {
    return new Response(
      JSON.stringify({ ok: false, reason: result.reason, issues: result.issues }),
      { status: result.status, headers: { 'content-type': 'application/json; charset=utf-8' } },
    );
  }
  return new Response(JSON.stringify({ ok: true, document: result.document }), {
    status: 200,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
};