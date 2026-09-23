/**
 * GET /api/sources — list every source document declared by the workspace.
 */
import type { APIRoute } from 'astro';
import {
  loadSource,
  loadWorkspaceContext,
  type SourceSummary,
} from '../../../lib/workspace.js';

export const prerender = false;

type ListItem =
  | { ok: true; source: SourceSummary }
  | { ok: false; path: string; status: 400 | 404 | 500; reason: string };

export const GET: APIRoute = async () => {
  const ctx = await loadWorkspaceContext();
  const items: ListItem[] = [];
  for (const entry of Object.values(ctx.workspace.data.resources.sources)) {
    const result = await loadSource(ctx.root, entry.relativePath);
    if (result.ok) {
      const summary: SourceSummary = {
        id: result.document.id,
        name: result.document.data.origin.name,
        type: result.document.data.origin.type,
        updatedAt: result.document.updatedAt,
        contentHash: result.document.data.origin.contentHash,
      };
      items.push({ ok: true, source: summary });
      continue;
    }
    items.push({
      ok: false,
      path: entry.relativePath,
      status: result.status,
      reason: result.reason,
    });
  }
  return new Response(JSON.stringify(items), {
    status: 200,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
};