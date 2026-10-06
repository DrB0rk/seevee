/**
 * GET /api/render/inspect — surface layout diagnostics for a presentation.
 */
import type { APIRoute } from 'astro';
import {
  loadCv,
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
  // Diagnostics are a measurement of the CV against the page box, so the CV the
  // presentation targets has to be loaded — inspecting without it can only
  // report "not measured".
  const cvEntry = ctx.workspace.data.resources.cvs[loaded.document.data.cvId];
  const cv = cvEntry === undefined
    ? undefined
    : await loadCv(ctx.root, cvEntry.relativePath);
  const cvs = cv?.ok === true ? new Map([[cv.document.id, cv.document]]) : undefined;
  const inspect = inspectPresentation({ presentation: loaded.document, cvs });
  return jsonResponse({ ok: true, presentationId, inspect }, 200);
};

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}