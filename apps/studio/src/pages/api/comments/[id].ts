/**
 * GET /api/comments/:id — fetch a single comments document.
 */
import type { APIRoute } from 'astro';
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { commentsDocumentSchema } from '@seevee/schema';
import { z } from 'zod';
import { loadComments, loadWorkspaceContext, resolveResourcePath } from '../../../lib/workspace.js';
import { workspaceWatcher } from '../../../lib/runtime.js';

export const prerender = false;

export const GET: APIRoute = async ({ params }) => {
  const id = params['id'];
  if (id === undefined || id.length === 0) {
    return jsonResponse({ ok: false, reason: 'missing id' }, 400);
  }
  const ctx = await loadWorkspaceContext();
  const entry = ctx.workspace.data.resources.comments[id] ?? Object.values(ctx.workspace.data.resources.comments).find((item) => item.cvId === id);
  if (entry === undefined) {
    return jsonResponse({ ok: false, reason: `comments ${id} not declared` }, 404);
  }
  const result = await loadComments(ctx.root, entry.relativePath);
  if (!result.ok) {
    return jsonResponse({ ok: false, reason: result.reason, issues: result.issues }, result.status);
  }
  return jsonResponse({ ok: true, document: result.document }, 200);
};

export const POST: APIRoute = async ({ params, request }) => {
  const cvId = params['id'];
  if (cvId === undefined || cvId.length === 0) return jsonResponse({ ok: false, reason: 'missing CV id' }, 400);
  const origin = request.headers.get('origin');
  if (origin && !isSameOrigin(request, origin)) return jsonResponse({ ok: false, reason: 'cross-origin writes are not allowed' }, 403);
  let body: unknown;
  try { body = await request.json(); } catch { return jsonResponse({ ok: false, reason: 'invalid JSON body' }, 400); }
  const parsedRequest = requestSchema.safeParse(body);
  if (!parsedRequest.success) return jsonResponse({ ok: false, reason: 'invalid comment save request' }, 400);
  const incomingThread = z.object({ id: z.string().min(3) }).passthrough().safeParse(parsedRequest.data.thread);
  if (!incomingThread.success) return jsonResponse({ ok: false, reason: 'comment thread is missing an id' }, 400);

  const ctx = await loadWorkspaceContext();
  const cvEntry = ctx.workspace.data.resources.cvs[cvId];
  if (!cvEntry) return jsonResponse({ ok: false, reason: `CV ${cvId} is not registered` }, 404);
  let commentsEntry = Object.values(ctx.workspace.data.resources.comments).find((item) => item.cvId === cvId);
  const now = new Date().toISOString();
  let current;
  if (commentsEntry) {
    const loaded = await loadComments(ctx.root, commentsEntry.relativePath);
    if (!loaded.ok) return jsonResponse({ ok: false, reason: loaded.reason, issues: loaded.issues }, loaded.status);
    current = loaded.document;
  } else {
    if (parsedRequest.data.expectedRevision !== 0) return jsonResponse({ ok: false, reason: 'comments changed; reload before saving' }, 409);
    commentsEntry = { id: cvId, relativePath: `comments/${cvId}.json`, cvId, revision: 0, updatedAt: now };
    current = { kind: 'seevee.comments' as const, schemaVersion: '1.0.0', id: cvId, revision: 0, createdAt: now, updatedAt: now, data: { threadOrder: [], threads: {} } };
  }
  if (current.revision !== parsedRequest.data.expectedRevision) {
    return jsonResponse({ ok: false, reason: 'comments changed since they were loaded; reload before saving', currentRevision: current.revision }, 409);
  }
  const document = commentsDocumentSchema.safeParse({
    ...current,
    revision: current.revision + 1,
    updatedAt: now,
    data: {
      ...current.data,
      threadOrder: [...current.data.threadOrder, incomingThread.data.id],
      threads: { ...current.data.threads, [incomingThread.data.id]: incomingThread.data },
    },
  });
  if (!document.success) return jsonResponse({ ok: false, reason: 'comment failed schema validation', issues: document.error.issues }, 400);

  await writeAtomically(resolveResourcePath(ctx.root, commentsEntry.relativePath), document.data);
  const workspace = structuredClone(ctx.workspace);
  workspace.revision += 1;
  workspace.updatedAt = now;
  workspace.data.resources.comments[commentsEntry.id] = { ...commentsEntry, revision: document.data.revision, updatedAt: now };
  await writeAtomically(path.join(ctx.root, 'seevee.json'), workspace);
  const watcher = await workspaceWatcher();
  watcher.broadcast({ type: 'comments.updated', cvId, path: commentsEntry.relativePath });
  return jsonResponse({ ok: true, document: document.data }, 201);
};

export const PUT: APIRoute = async ({ params, request }) => {
  const cvId = params['id'];
  if (!cvId) return jsonResponse({ ok: false, reason: 'missing CV id' }, 400);
  const origin = request.headers.get('origin');
  if (origin && !isSameOrigin(request, origin)) return jsonResponse({ ok: false, reason: 'cross-origin writes are not allowed' }, 403);
  let body: unknown;
  try { body = await request.json(); } catch { return jsonResponse({ ok: false, reason: 'invalid JSON body' }, 400); }
  const parsed = updateSchema.safeParse(body);
  if (!parsed.success) return jsonResponse({ ok: false, reason: 'invalid comment update request' }, 400);
  const ctx = await loadWorkspaceContext();
  const entry = Object.values(ctx.workspace.data.resources.comments).find((item) => item.cvId === cvId);
  if (!entry) return jsonResponse({ ok: false, reason: `comments for CV ${cvId} are not registered` }, 404);
  const loaded = await loadComments(ctx.root, entry.relativePath);
  if (!loaded.ok) return jsonResponse({ ok: false, reason: loaded.reason, issues: loaded.issues }, loaded.status);
  if (loaded.document.revision !== parsed.data.expectedRevision) return jsonResponse({ ok: false, reason: 'comments changed since they were loaded; reload before saving', currentRevision: loaded.document.revision }, 409);
  const thread = loaded.document.data.threads[parsed.data.threadId];
  if (!thread) return jsonResponse({ ok: false, reason: `comment ${parsed.data.threadId} not found` }, 404);
  const now = new Date().toISOString();
  const updated = structuredClone(loaded.document);
  const updatedThread = updated.data.threads[parsed.data.threadId]!;
  if (parsed.data.body !== undefined) {
    const previousId = updatedThread.messageOrder.at(-1);
    const messageId = `message_${randomUUID().replace(/-/g, '')}`;
    updatedThread.messages[messageId] = {
      id: messageId,
      author: { kind: 'user', display: 'You' },
      body: parsed.data.body,
      createdAt: now,
      ...(previousId ? { supersedesMessageId: previousId } : {}),
    };
    updatedThread.messageOrder.push(messageId);
  }
  if (parsed.data.placement) {
    const region = updatedThread.target.selectors.find((selector) => selector.type === 'PageRegionSelector');
    if (!region || region.type !== 'PageRegionSelector') return jsonResponse({ ok: false, reason: 'comment has no page location to move' }, 400);
    region.x = parsed.data.placement.x;
    region.y = parsed.data.placement.y;
    if (parsed.data.placement.element !== undefined) {
      updatedThread.target.selectors = updatedThread.target.selectors.filter((selector) => !['NodeSelector', 'FieldSelector', 'SectionSelector', 'TextQuoteSelector'].includes(selector.type));
      if (parsed.data.placement.selector) updatedThread.target.selectors.push(parsed.data.placement.selector);
    }
    const previous = updatedThread.target.extensions?.['seevee.placement'];
    const placement = previous && typeof previous === 'object' ? previous as Record<string, unknown> : {};
    updatedThread.target.extensions = {
      ...updatedThread.target.extensions,
      'seevee.placement': {
        ...placement,
        page: region.page,
        x: region.x,
        y: region.y,
        ...(parsed.data.placement.element !== undefined ? { element: parsed.data.placement.element } : {}),
        ...(parsed.data.placement.contextText !== undefined ? { contextText: parsed.data.placement.contextText } : {}),
        ...(parsed.data.placement.fieldPath !== undefined ? { fieldPath: parsed.data.placement.fieldPath } : {}),
      },
    };
  }
  updatedThread.updatedAt = now;
  updated.revision += 1;
  updated.updatedAt = now;
  const valid = commentsDocumentSchema.safeParse(updated);
  if (!valid.success) return jsonResponse({ ok: false, reason: 'comment update failed schema validation', issues: valid.error.issues }, 400);
  await persistComments(ctx.root, ctx.workspace, entry, valid.data, now);
  return jsonResponse({ ok: true, document: valid.data }, 200);
};

export const DELETE: APIRoute = async ({ params, request }) => {
  const cvId = params['id'];
  if (!cvId) return jsonResponse({ ok: false, reason: 'missing CV id' }, 400);
  const origin = request.headers.get('origin');
  if (origin && !isSameOrigin(request, origin)) return jsonResponse({ ok: false, reason: 'cross-origin writes are not allowed' }, 403);
  let body: unknown;
  try { body = await request.json(); } catch { return jsonResponse({ ok: false, reason: 'invalid JSON body' }, 400); }
  const parsed = deleteSchema.safeParse(body);
  if (!parsed.success) return jsonResponse({ ok: false, reason: 'invalid comment deletion request' }, 400);
  const ctx = await loadWorkspaceContext();
  const entry = Object.values(ctx.workspace.data.resources.comments).find((item) => item.cvId === cvId);
  if (!entry) return jsonResponse({ ok: false, reason: `comments for CV ${cvId} are not registered` }, 404);
  const loaded = await loadComments(ctx.root, entry.relativePath);
  if (!loaded.ok) return jsonResponse({ ok: false, reason: loaded.reason, issues: loaded.issues }, loaded.status);
  if (loaded.document.revision !== parsed.data.expectedRevision) return jsonResponse({ ok: false, reason: 'comments changed since they were loaded; reload before deleting', currentRevision: loaded.document.revision }, 409);
  if (!loaded.document.data.threads[parsed.data.threadId]) return jsonResponse({ ok: false, reason: `comment ${parsed.data.threadId} not found` }, 404);
  const now = new Date().toISOString();
  const updated = structuredClone(loaded.document);
  delete updated.data.threads[parsed.data.threadId];
  updated.data.threadOrder = updated.data.threadOrder.filter((id) => id !== parsed.data.threadId);
  updated.revision += 1;
  updated.updatedAt = now;
  const valid = commentsDocumentSchema.safeParse(updated);
  if (!valid.success) return jsonResponse({ ok: false, reason: 'comment deletion failed schema validation', issues: valid.error.issues }, 400);
  await persistComments(ctx.root, ctx.workspace, entry, valid.data, now);
  return jsonResponse({ ok: true, document: valid.data }, 200);
};

const requestSchema = z.object({
  expectedRevision: z.number().int().min(0),
  thread: z.unknown(),
}).strict();
const updateSchema = z.object({
  expectedRevision: z.number().int().min(0),
  threadId: z.string().min(3),
  body: z.string().trim().min(1).optional(),
  placement: z.object({
    x: z.number().min(0).max(0.985),
    y: z.number().min(0).max(0.985),
    element: z.string().max(240).optional(),
    contextText: z.string().max(280).nullable().optional(),
    fieldPath: z.string().max(500).nullable().optional(),
    selector: z.discriminatedUnion('type', [
      z.object({ type: z.literal('NodeSelector'), nodeId: z.string().min(3), nodeType: z.string().min(1) }).strict(),
      z.object({ type: z.literal('FieldSelector'), nodeId: z.string().min(3), nodeType: z.string().min(1), field: z.string() }).strict(),
      z.object({ type: z.literal('SectionSelector'), sectionId: z.string().min(3) }).strict(),
    ]).nullable().optional(),
  }).strict().optional(),
}).strict().refine((value) => value.body !== undefined || value.placement !== undefined);
const deleteSchema = z.object({ expectedRevision: z.number().int().min(0), threadId: z.string().min(3) }).strict();

async function persistComments(root: string, workspaceDocument: Awaited<ReturnType<typeof loadWorkspaceContext>>['workspace'], entry: { id: string; relativePath: string; cvId: string; revision: number; updatedAt: string }, document: z.infer<typeof commentsDocumentSchema>, now: string): Promise<void> {
  await writeAtomically(resolveResourcePath(root, entry.relativePath), document);
  const workspace = structuredClone(workspaceDocument);
  workspace.revision += 1;
  workspace.updatedAt = now;
  workspace.data.resources.comments[entry.id] = { ...entry, revision: document.revision, updatedAt: now };
  await writeAtomically(path.join(root, 'seevee.json'), workspace);
  const watcher = await workspaceWatcher();
  watcher.broadcast({ type: 'comments.updated', cvId: entry.cvId, path: entry.relativePath });
}

function isSameOrigin(request: Request, origin: string): boolean {
  try {
    const originUrl = new URL(origin);
    const requestUrl = new URL(request.url);
    const host = request.headers.get('host') ?? requestUrl.host;
    const protocol = request.headers.get('x-forwarded-proto')?.split(',')[0]?.trim() ?? requestUrl.protocol.slice(0, -1);
    return originUrl.origin === new URL(`${protocol}://${host}`).origin;
  } catch { return false; }
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
