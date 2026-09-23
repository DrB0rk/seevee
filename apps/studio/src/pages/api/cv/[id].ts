/**
 * GET /api/cv/:id — fetch a single CV document.
 *
 * The dashboard's right inspector and left rail both anchor to this
 * endpoint. The path parameter must be a CV identifier that the workspace
 * index actually declares; otherwise we return 404 (not 400) so callers
 * can distinguish "no such CV" from "found a CV but its file is invalid".
 */
import type { APIRoute } from 'astro';
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { cvDocumentSchema } from '@seevee/schema';
import { loadCv, loadWorkspaceContext, resolveResourcePath } from '../../../lib/workspace.js';
import { workspaceWatcher } from '../../../lib/runtime.js';

export const prerender = false;

export const GET: APIRoute = async ({ params }) => {
  const id = params['id'];
  if (id === undefined || id.length === 0) {
    return jsonResponse({ ok: false, reason: 'missing id' }, 400);
  }
  const ctx = await loadWorkspaceContext();
  const entry = ctx.workspace.data.resources.cvs[id];
  if (entry === undefined) {
    return jsonResponse({ ok: false, reason: `cv ${id} not declared` }, 404);
  }
  const result = await loadCv(ctx.root, entry.relativePath);
  if (!result.ok) {
    return jsonResponse({ ok: false, reason: result.reason, issues: result.issues }, result.status);
  }
  return jsonResponse({ ok: true, document: result.document }, 200);
};

export const PUT: APIRoute = async ({ params, request }) => {
  const id = params['id'];
  if (id === undefined || id.length === 0) return jsonResponse({ ok: false, reason: 'missing id' }, 400);
  const origin = request.headers.get('origin');
  if (origin && !isSameOrigin(request, origin)) {
    return jsonResponse({ ok: false, reason: 'cross-origin writes are not allowed' }, 403);
  }
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ ok: false, reason: 'invalid JSON body' }, 400);
  }
  const requestSchema = z.object({ expectedRevision: z.number().int().min(0), document: z.unknown() }).strict();
  const requestBody = requestSchema.safeParse(body);
  if (!requestBody.success) return jsonResponse({ ok: false, reason: 'invalid save request' }, 400);
  const parsedDocument = cvDocumentSchema.safeParse(requestBody.data.document);
  if (!parsedDocument.success) {
    return jsonResponse({ ok: false, reason: 'CV failed schema validation', issues: parsedDocument.error.issues }, 400);
  }
  if (parsedDocument.data.id !== id) return jsonResponse({ ok: false, reason: 'CV id does not match route' }, 400);

  const ctx = await loadWorkspaceContext();
  const entry = ctx.workspace.data.resources.cvs[id];
  if (!entry) return jsonResponse({ ok: false, reason: `cv ${id} not declared` }, 404);
  const current = await loadCv(ctx.root, entry.relativePath);
  if (!current.ok) return jsonResponse({ ok: false, reason: current.reason, issues: current.issues }, current.status);
  if (requestBody.data.expectedRevision !== current.document.revision) {
    return jsonResponse({ ok: false, reason: 'CV changed since it was loaded; reload before saving', currentRevision: current.document.revision }, 409);
  }
  if (parsedDocument.data.revision !== current.document.revision) {
    return jsonResponse({ ok: false, reason: 'document revision does not match expectedRevision' }, 400);
  }

  const now = new Date().toISOString();
  const document = { ...parsedDocument.data, revision: current.document.revision + 1, updatedAt: now };
  const validDocument = cvDocumentSchema.parse(document);
  const cvPath = resolveResourcePath(ctx.root, entry.relativePath);
  await writeAtomically(cvPath, validDocument);

  const workspace = structuredClone(ctx.workspace);
  workspace.revision += 1;
  workspace.updatedAt = now;
  workspace.data.resources.cvs[id] = { ...entry, revision: validDocument.revision, updatedAt: now };
  await writeAtomically(path.join(ctx.root, 'seevee.json'), workspace);

  const watcher = await workspaceWatcher();
  watcher.broadcast({ type: 'cv.updated', cvId: id, revision: validDocument.revision, path: entry.relativePath });
  return jsonResponse({ ok: true, document: validDocument }, 200);
};

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
