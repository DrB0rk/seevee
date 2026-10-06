/**
 * POST /api/render/preview — re-render a CV against a page profile.
 *
 * Accepts `{ cvId, profile?, presentationId? }` in the JSON body. When
 * `presentationId` is omitted the dashboard uses the presentation whose
 * `data.cvId` matches `cvId`. When `profile` is provided it overrides
 * the presentation's preset (still resolved through `PageProfile`).
 *
 * The response executes the workspace's real template: the presentation's
 * `data.template` selection resolves to a template version directory, that
 * version's Astro entry is rendered against the CV, and the fragment is
 * returned as a full HTML document alongside the page array and diagnostics.
 * The response shape is unchanged — `result.pages` still carries one entry per
 * physical page, and each page now carries its own HTML — so existing clients
 * keep working.
 *
 * Template faults are surfaced as structured failures (422/404) rather than
 * thrown, because a broken template is a document-state problem the dashboard
 * should render, not a 500 that hides the reason.
 */
import type { APIRoute } from 'astro';
import { z } from 'zod';
import {
  loadCv,
  loadPresentation,
  loadWorkspaceContext,
  type WorkspaceContext,
} from '../../../lib/workspace.js';
import { renderCvToPages } from '../../../lib/renderer.js';
import { resolveTemplateRoot } from '../../../lib/template-root.js';
import { isTemplateRenderError, type TemplateRenderErrorCode } from '@seevee/template-render';

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
  const cvEntry = ctx.workspace.data.resources.cvs[cvId];
  if (cvEntry === undefined) {
    return jsonResponse({ ok: false, reason: `cv ${cvId} not declared` }, 404);
  }
  const cv = await loadCv(ctx.root, cvEntry.relativePath);
  if (!cv.ok) {
    return jsonResponse({ ok: false, reason: cv.reason, issues: cv.issues }, cv.status);
  }

  const selection = loaded.document.data.template;
  let template;
  try {
    template = await resolveTemplateRoot(ctx, selection.templateId, selection.versionId);
  } catch (error) {
    return jsonResponse(
      {
        ok: false,
        reason: error instanceof Error ? error.message : 'template resolution failed',
      },
      422,
    );
  }

  let result;
  try {
    result = await renderCvToPages({
      cv: cv.document,
      presentation: loaded.document,
      template: { root: template.root, entry: template.manifest.entry },
      profile,
    });
  } catch (error) {
    if (isTemplateRenderError(error)) {
      return jsonResponse(
        {
          ok: false,
          reason: error.message,
          templateCode: error.code satisfies TemplateRenderErrorCode,
        },
        422,
      );
    }
    throw error;
  }
  return jsonResponse(
    {
      ok: true,
      cvId,
      presentationId: resolved.locator.id,
      profile: profile ?? loaded.document.data.page.preset,
      template: {
        templateId: selection.templateId,
        versionId: selection.versionId,
        entry: template.manifest.entry,
      },
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