/**
 * GET /api/presentation — list every presentation declared by the workspace.
 */
import type { APIRoute } from 'astro';
import {
  loadPresentation,
  loadWorkspaceContext,
  resolvePageGeometry,
  type PresentationSummary,
} from '../../../lib/workspace.js';

export const prerender = false;

type ListItem =
  | { ok: true; presentation: PresentationSummary }
  | { ok: false; path: string; status: 400 | 404 | 500; reason: string };

export const GET: APIRoute = async () => {
  const ctx = await loadWorkspaceContext();
  const items: ListItem[] = [];
  for (const entry of Object.values(ctx.workspace.data.resources.presentations)) {
    const result = await loadPresentation(ctx.root, entry.relativePath);
    if (result.ok) {
      const data = result.document.data;
      const geometry = resolvePageGeometry(data);
      const summary: PresentationSummary = {
        id: result.document.id,
        cvId: data.cvId,
        revision: result.document.revision,
        updatedAt: result.document.updatedAt,
        templateId: data.template.templateId,
        versionId: data.template.versionId,
        preset: geometry.preset,
        orientation: geometry.orientation,
        widthMm: geometry.widthMm,
        heightMm: geometry.heightMm,
        edges: data.page.edges ?? { top: 12, right: 12, bottom: 12, left: 12 },
        tokens: data.tokens,
      };
      items.push({ ok: true, presentation: summary });
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
