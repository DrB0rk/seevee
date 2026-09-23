/**
 * POST /api/render/preview — re-render a CV against a page profile.
 *
 * Accepts `{ cvId, profile?, presentationId? }` in the JSON body. When
 * `presentationId` is omitted the dashboard uses the presentation whose
 * `data.cvId` matches `cvId`. When `profile` is provided it overrides
 * the presentation's preset (still resolved through `PageProfile`).
 *
 * The current implementation calls the deterministic renderer stub and
 * returns the page array plus diagnostics. The full Playwright renderer
 * will replace `renderCvToPages` without changing the response shape.
 */
import type { APIRoute } from 'astro';
import { z } from 'zod';
import {
  loadPresentation,
  loadWorkspaceContext,
  type WorkspaceContext,
} from '../../../lib/workspace.js';
import { renderCvToPages } from '../../../lib/renderer.js';

export const prerender = false;

const bodySchema = z.object({
  cvId: z.string().min(1),
  presentationId: z.string().min(1).optional(),
  profile: z.enum(['A4', 'Letter', 'custom']).optional(),
});

interface PresentationLocator {
  id: string;
  relativePath: string;
}

type ResolutionOutcome =
  | { ok: true; locator: PresentationLocator }
  | { ok: false; status: 404; reason: string };

async function resolvePresentation(
  ctx: WorkspaceContext,
  cvId: string,
  presentationId: string | undefined,
): Promise<ResolutionOutcome> {
  const resources = ctx.workspace.data.resources;
  if (presentationId !== undefined) {
    const entry = resources.presentations[presentationId];
    if (entry === undefined) {
      return { ok: false, status: 404, reason: `presentation ${presentationId} not declared` };
    }
    const loaded = await loadPresentation(ctx.root, entry.relativePath);
    if (loaded.ok && loaded.document.data.cvId !== cvId) {
      return {
        ok: false,
        status: 404,
        reason: `presentation ${presentationId} does not target cv ${cvId}`,
      };
    }
    return { ok: true, locator: { id: presentationId, relativePath: entry.relativePath } };
  }
  const matches: PresentationLocator[] = [];
  for (const entry of Object.values(resources.presentations)) {
    const loaded = await loadPresentation(ctx.root, entry.relativePath);
    if (loaded.ok && loaded.document.data.cvId === cvId) {
      matches.push({ id: entry.id, relativePath: entry.relativePath });
    }
  }
  if (matches.length === 0) {
    return { ok: false, status: 404, reason: `no presentation declared for cv ${cvId}` };
  }
  return { ok: true, locator: matches[0]! };
}

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
  const { cvId, presentationId, profile } = parsed.data;
  const ctx = await loadWorkspaceContext();
  const resolved = await resolvePresentation(ctx, cvId, presentationId);
  if (!resolved.ok) {
    return jsonResponse({ ok: false, reason: resolved.reason }, resolved.status);
  }
  const loaded = await loadPresentation(ctx.root, resolved.locator.relativePath);
  if (!loaded.ok) {
    return jsonResponse({ ok: false, reason: loaded.reason, issues: loaded.issues }, loaded.status);
  }
  const result = await renderCvToPages({ cvId, presentation: loaded.document, profile });
  return jsonResponse(
    {
      ok: true,
      cvId,
      presentationId: resolved.locator.id,
      profile: profile ?? loaded.document.data.page.preset,
      result,
    },
    200,
  );
};

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}