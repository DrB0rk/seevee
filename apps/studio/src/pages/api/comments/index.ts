/**
 * GET /api/comments — list every comment thread declared by the workspace.
 */
import type { APIRoute } from 'astro';
import {
  loadComments,
  loadWorkspaceContext,
  type CommentSummary,
} from '../../../lib/workspace.js';

export const prerender = false;

type ListItem =
  | { ok: true; comments: CommentSummary }
  | { ok: false; path: string; status: 400 | 404 | 500; reason: string };

export const GET: APIRoute = async () => {
  const ctx = await loadWorkspaceContext();
  const items: ListItem[] = [];
  for (const entry of Object.values(ctx.workspace.data.resources.comments)) {
    const result = await loadComments(ctx.root, entry.relativePath);
    if (result.ok) {
      const doc = result.document;
      const threads = Object.values(doc.data.threads);
      const open = threads.filter((t) => t.status === 'open' || t.status === 'in_progress').length;
      const summary: CommentSummary = {
        id: doc.id,
        cvId: doc.data.threads[Object.keys(doc.data.threads)[0] ?? '']?.target.source.resourceId
          ?? entry.cvId,
        revision: doc.revision,
        updatedAt: doc.updatedAt,
        threadCount: threads.length,
        openCount: open,
      };
      items.push({ ok: true, comments: summary });
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