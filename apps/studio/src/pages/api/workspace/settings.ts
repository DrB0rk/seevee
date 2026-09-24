import type { APIRoute } from 'astro';
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { workspaceDocumentSchema } from '@seevee/schema';
import { loadWorkspaceContext } from '../../../lib/workspace.js';

export const prerender = false;

const policyPatchSchema = z.object({
  allowAgentFactInference: z.boolean().optional(),
  requireEvidenceForNumericClaims: z.boolean().optional(),
  allowForceExportWithOverflow: z.boolean().optional(),
  autoResolveDeterministicComments: z.boolean().optional(),
}).strict();

const patchSchema = z.object({
  expectedRevision: z.number().int().min(0),
  name: z.string().trim().min(1).max(120).optional(),
  policy: policyPatchSchema.optional(),
}).strict().refine((value) => value.name !== undefined || value.policy !== undefined);

type SettingsPayload = {
  id: string;
  revision: number;
  name: string;
  policy: {
    allowAgentFactInference: boolean;
    requireEvidenceForNumericClaims: boolean;
    allowForceExportWithOverflow: boolean;
    autoResolveDeterministicComments: boolean;
  };
};

export const GET: APIRoute = async () => {
  try {
    const { workspace } = await loadWorkspaceContext();
    return jsonResponse({ ok: true, settings: settingsPayload(workspace) }, 200);
  } catch (error) {
    return jsonResponse({ ok: false, reason: error instanceof Error ? error.message : 'Could not read workspace settings.' }, 500);
  }
};

export const PATCH: APIRoute = async ({ request }) => {
  const origin = request.headers.get('origin');
  if (origin && !isSameOrigin(request, origin)) return jsonResponse({ ok: false, reason: 'cross-origin writes are not allowed' }, 403);

  let body: unknown;
  try { body = await request.json(); } catch { return jsonResponse({ ok: false, reason: 'invalid JSON body' }, 400); }
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) return jsonResponse({ ok: false, reason: 'invalid workspace settings' }, 400);

  let context: Awaited<ReturnType<typeof loadWorkspaceContext>>;
  try { context = await loadWorkspaceContext(); } catch (error) {
    return jsonResponse({ ok: false, reason: error instanceof Error ? error.message : 'Could not load workspace.' }, 500);
  }
  if (context.workspace.revision !== parsed.data.expectedRevision) {
    return jsonResponse({ ok: false, reason: 'workspace settings changed elsewhere; reload before saving', revision: context.workspace.revision }, 409);
  }

  const now = new Date().toISOString();
  const candidate = structuredClone(context.workspace);
  candidate.revision += 1;
  candidate.updatedAt = now;
  if (parsed.data.name !== undefined) candidate.data.name = parsed.data.name;
  if (parsed.data.policy) candidate.data.policy = { ...candidate.data.policy, ...parsed.data.policy };
  const validated = workspaceDocumentSchema.safeParse(candidate);
  if (!validated.success) return jsonResponse({ ok: false, reason: 'workspace settings failed schema validation' }, 400);

  try {
    await writeAtomically(path.join(context.root, 'seevee.json'), validated.data);
  } catch (error) {
    return jsonResponse({ ok: false, reason: error instanceof Error ? error.message : 'Could not save workspace settings.' }, 500);
  }
  return jsonResponse({ ok: true, settings: settingsPayload(validated.data) }, 200);
};

function settingsPayload(workspace: z.infer<typeof workspaceDocumentSchema>): SettingsPayload {
  const { id, revision, data } = workspace;
  return { id, revision, name: data.name, policy: data.policy };
}

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
