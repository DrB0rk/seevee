/**
 * POST /api/export/pdf — generate a PDF for a presentation.
 *
 * Runs the real pipeline: `@seevee/template-render` executes the
 * template's Astro source, `@seevee/export` assembles a printable
 * document from that fragment plus the template's scoped CSS, and
 * Chromium captures it to PDF while the physical page dimensions are
 * verified against the presentation's page profile.
 *
 * A missing Chromium binary is reported as 503 with an actionable
 * message rather than an opaque Playwright failure — the first export
 * downloads the browser (~150MB) and then runs offline.
 *
 * With `download: true` the PDF is returned as the response body; the
 * default returns JSON metadata plus the artifact path so the UI can
 * link to the file it just wrote.
 */
import type { APIRoute } from 'astro';
import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { mkdir, readFile } from 'node:fs/promises';

import {
  exportToPdf,
  ChromiumMissingError,
  PlaywrightNotInstalledError,
} from '@seevee/export';

import {
  loadCv,
  loadPresentation,
  loadWorkspaceContext,
} from '../../../lib/workspace.js';
import {
  resolveTemplateRoot,
  type ResolvedTemplateRoot,
} from '../../../lib/template-root.js';
import { workspaceWatcher } from '../../../lib/runtime.js';

export const prerender = false;

const bodySchema = z.object({
  presentationId: z.string().min(1),
  forceOverflow: z.boolean().optional(),
  download: z.boolean().optional(),
});

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
  const { presentationId, forceOverflow, download } = parsed.data;

  const ctx = await loadWorkspaceContext();
  const entry = ctx.workspace.data.resources.presentations[presentationId];
  if (entry === undefined) {
    return jsonResponse({ ok: false, reason: 'presentation not declared' }, 404);
  }
  const loaded = await loadPresentation(ctx.root, entry.relativePath);
  if (!loaded.ok) {
    return jsonResponse({ ok: false, reason: loaded.reason, issues: loaded.issues }, loaded.status);
  }

  const cvId = loaded.document.data.cvId;
  const cvEntry = ctx.workspace.data.resources.cvs[cvId];
  if (cvEntry === undefined) {
    return jsonResponse({ ok: false, reason: `cv ${cvId} not declared` }, 404);
  }
  const cv = await loadCv(ctx.root, cvEntry.relativePath);
  if (!cv.ok) {
    return jsonResponse({ ok: false, reason: cv.reason, issues: cv.issues }, cv.status);
  }

  const selection = loaded.document.data.template;
  let template: ResolvedTemplateRoot;
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

  const outputDir = join(ctx.root, 'exports');
  await mkdir(outputDir, { recursive: true });
  const outputPath = join(outputDir, `${presentationId}-${randomUUID()}.pdf`);

  let result;
  try {
    result = await exportToPdf({
      workspaceRoot: ctx.root,
      cvId,
      presentationId,
      templateArtifactPath: template.root,
      outputPath,
      pageProfile: loaded.document.data.page,
      allowForcedExport: forceOverflow === true,
    });
  } catch (error) {
    if (
      error instanceof ChromiumMissingError ||
      error instanceof PlaywrightNotInstalledError
    ) {
      return jsonResponse(
        { ok: false, reason: error.message, code: error.name },
        503,
      );
    }
    const message = error instanceof Error ? error.message : 'export failed';
    const name = error instanceof Error ? error.name : 'Error';
    // Layout overflow is a real, actionable authoring problem rather than
    // a server fault — the UI can offer "export anyway".
    const isDiagnostics = name === 'RenderDiagnosticsError';
    return jsonResponse(
      { ok: false, reason: message, code: name },
      isDiagnostics ? 422 : 500,
    );
  }

  const watcher = await workspaceWatcher();
  watcher.broadcast({ type: 'export.completed', exportId: result.exportId });

  if (download === true) {
    const pdf = await readFile(result.outputPath);
    return new Response(new Uint8Array(pdf), {
      status: 200,
      headers: {
        'content-type': 'application/pdf',
        'content-disposition': `attachment; filename="${cvId}.pdf"`,
      },
    });
  }

  return jsonResponse(
    {
      ok: true,
      exportId: result.exportId,
      outputPath: result.outputPath,
      pageCount: result.pageCount,
      estimatedPageCount: result.estimatedPageCount,
      bytes: result.bytes,
      sha256: result.sha256,
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