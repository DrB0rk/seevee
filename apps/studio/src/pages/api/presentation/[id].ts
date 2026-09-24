/**
 * GET /api/presentation/:id — fetch a single presentation document.
 */
import type { APIRoute } from 'astro';
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { presentationDocumentSchema, pageProfileSchema, tokensSchema } from '@seevee/schema';
import { z } from 'zod';
import { loadPresentation, loadWorkspaceContext, resolveResourcePath } from '../../../lib/workspace.js';
import { workspaceWatcher } from '../../../lib/runtime.js';

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

export const PATCH: APIRoute = async ({ params, request }) => {
  const id = params['id'];
  if (!id) return jsonResponse({ ok: false, reason: 'missing id' }, 400);
  const origin = request.headers.get('origin');
  if (origin && !isSameOrigin(request, origin)) return jsonResponse({ ok: false, reason: 'cross-origin writes are not allowed' }, 403);
  let body: unknown;
  try { body = await request.json(); } catch { return jsonResponse({ ok: false, reason: 'invalid JSON body' }, 400); }
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) return jsonResponse({ ok: false, reason: 'invalid presentation update' }, 400);

  const ctx = await loadWorkspaceContext();
  const entry = ctx.workspace.data.resources.presentations[id];
  if (!entry) return jsonResponse({ ok: false, reason: `presentation ${id} not declared` }, 404);
  const loaded = await loadPresentation(ctx.root, entry.relativePath);
  if (!loaded.ok) return jsonResponse({ ok: false, reason: loaded.reason, issues: loaded.issues }, loaded.status);
  if (loaded.document.revision !== parsed.data.expectedRevision) {
    return jsonResponse({ ok: false, reason: 'presentation changed since settings were loaded; reload before saving', currentRevision: loaded.document.revision }, 409);
  }

  const now = new Date().toISOString();
  const updated = presentationDocumentSchema.safeParse({
    ...loaded.document,
    revision: loaded.document.revision + 1,
    updatedAt: now,
    data: {
      ...loaded.document.data,
      ...(parsed.data.page ? { page: parsed.data.page } : {}),
      ...(parsed.data.tokens ? { tokens: { ...loaded.document.data.tokens, ...parsed.data.tokens } } : {}),
    },
  });
  if (!updated.success) return jsonResponse({ ok: false, reason: 'presentation failed schema validation', issues: updated.error.issues }, 400);
  await writeAtomically(resolveResourcePath(ctx.root, entry.relativePath), updated.data);
  const workspace = structuredClone(ctx.workspace);
  workspace.revision += 1;
  workspace.updatedAt = now;
  workspace.data.resources.presentations[id] = { ...entry, revision: updated.data.revision, updatedAt: now };
  await writeAtomically(path.join(ctx.root, 'seevee.json'), workspace);
  const watcher = await workspaceWatcher();
  watcher.broadcast({ type: 'presentation.updated', presentationId: id, path: entry.relativePath });
  return jsonResponse({ ok: true, document: updated.data }, 200);
};

const patchSchema = z.object({
  expectedRevision: z.number().int().min(0),
  page: pageProfileSchema.optional(),
  tokens: tokensSchema.optional(),
}).strict().refine((value) => value.page !== undefined || value.tokens !== undefined);

function isSameOrigin(request: Request, origin: string): boolean {
  try {
    const originUrl = new URL(origin);
    const requestUrl = new URL(request.url);
    const host = request.headers.get('host') ?? requestUrl.host;
    const protocol = request.headers.get('x-forwarded-proto')?.split(',')[0]?.trim() ?? requestUrl.protocol.slice(0, -1);
    return originUrl.origin === new URL(`${protocol}://${host}`).origin;
  } catch {
    return false;
  }
}

async function writeAtomically(file: string, document: unknown): Promise<void> {
  const temporary = `${file}.${randomUUID()}.tmp`;
  await fs.mkdir(path.dirname(file), { recursive: true });
  try {
    await fs.writeFile(temporary, `${JSON.stringify(document, null, 2)}\n`, 'utf8');
    await fs.rename(temporary, file);
  } catch (error) {
    await fs.rm(temporary, { force: true }).catch(() => {});
    throw error;
  }
}

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}
