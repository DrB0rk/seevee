/**
 * GET /api/cv — list every CV declared by the workspace.
 *
 * Reads the workspace marker, resolves each `cvs/<id>.json` declared in
 * `resources.cvs`, parses it with `cvDocumentSchema`, and returns a flat
 * JSON array of summary records. A document that fails validation is
 * surfaced inline as `{ ok: false, ... }` so the dashboard can render a
 * per-row error without dropping the whole list.
 */
import type { APIRoute } from 'astro';
import {
  loadCv,
  loadWorkspaceContext,
  summariseCv,
  type CvSummary,
  type ResourceFailure,
} from '../../../lib/workspace.js';

export const prerender = false;

type CvListItem =
  | { ok: true; cv: CvSummary }
  | { ok: false; path: string; status: 400 | 404 | 500; reason: string };

export const GET: APIRoute = async () => {
  const ctx = await loadWorkspaceContext();
  const items: CvListItem[] = [];
  const entries = Object.values(ctx.workspace.data.resources.cvs);
  for (const entry of entries) {
    const result = await loadCv(ctx.root, entry.relativePath);
    if (result.ok) {
      items.push({ ok: true, cv: summariseCv(result.document) });
      continue;
    }
    const failure: ResourceFailure = result;
    items.push({
      ok: false,
      path: entry.relativePath,
      status: failure.status,
      reason: failure.reason,
    });
  }
  return new Response(JSON.stringify(items), {
    status: 200,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
};