/**
 * GET /api/template-style?templateId=...&versionId=...
 * Read a template-owned stylesheet for the dashboard's CV canvas.
 */
import type { APIRoute } from 'astro';
import fs from 'node:fs/promises';
import path from 'node:path';
import { templateManifestDocumentSchema } from '@seevee/schema';
import { loadWorkspaceContext, resolveResourcePath } from '../../lib/workspace.js';

export const prerender = false;

const MAX_STYLESHEET_BYTES = 512 * 1024;

export const GET: APIRoute = async ({ url }) => {
  const templateId = url.searchParams.get('templateId');
  const versionId = url.searchParams.get('versionId');
  if (!templateId || !versionId) return jsonResponse({ ok: false, reason: 'templateId and versionId are required' }, 400);

  const { root, workspace } = await loadWorkspaceContext();
  const entry = workspace.data.resources.templates[templateId];
  if (!entry) return jsonResponse({ ok: false, reason: 'template is not registered in this workspace' }, 404);

  const manifestPath = await findManifest(root, entry.relativePath, templateId, versionId);
  if (!manifestPath) return jsonResponse({ ok: false, reason: 'matching template version was not found' }, 404);

  const stylesheetPath = path.join(path.dirname(manifestPath), 'styles', 'dashboard.css');
  try {
    const safeStylesheetPath = await resolveInsideRoot(root, stylesheetPath);
    const stylesheet = await fs.readFile(safeStylesheetPath, 'utf8');
    if (Buffer.byteLength(stylesheet, 'utf8') > MAX_STYLESHEET_BYTES) {
      return jsonResponse({ ok: false, reason: 'template dashboard stylesheet is too large' }, 413);
    }
    return jsonResponse({ ok: true, css: `@scope (.cv-content) {\n${stylesheet}\n}` }, 200);
  } catch (error) {
    if (isMissingFile(error)) return jsonResponse({ ok: true, css: '' }, 200);
    return jsonResponse({ ok: false, reason: 'could not read template dashboard stylesheet' }, 500);
  }
};

async function findManifest(root: string, relativePath: string, templateId: string, versionId: string): Promise<string | null> {
  const registeredPath = resolveResourcePath(root, relativePath);
  const registeredStat = await fs.stat(registeredPath).catch(() => null);
  const searchRoot = registeredStat?.isDirectory() ? registeredPath : path.dirname(registeredPath);
  const candidates = new Set<string>();
  if (registeredStat?.isFile()) candidates.add(registeredPath);
  if (registeredStat?.isDirectory()) candidates.add(path.join(registeredPath, 'template.json'));
  candidates.add(path.join(searchRoot, 'template.json'));
  const children = await fs.readdir(searchRoot, { withFileTypes: true }).catch(() => []);
  for (const child of children) {
    if (child.isDirectory()) candidates.add(path.join(searchRoot, child.name, 'template.json'));
  }

  for (const candidate of candidates) {
    try {
      const safeCandidate = await resolveInsideRoot(root, candidate);
      const raw = JSON.parse(await fs.readFile(safeCandidate, 'utf8')) as unknown;
      const parsed = templateManifestDocumentSchema.safeParse(raw);
      if (parsed.success && parsed.data.templateId === templateId && parsed.data.id === versionId) return safeCandidate;
    } catch {
      // Ignore missing or invalid candidates; only an exact registered version is served.
    }
  }
  return null;
}

async function resolveInsideRoot(root: string, candidate: string): Promise<string> {
  const realRoot = await fs.realpath(root);
  const realCandidate = await fs.realpath(candidate);
  const relative = path.relative(realRoot, realCandidate);
  if (relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('template file resolves outside the workspace');
  return realCandidate;
}

function isMissingFile(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT';
}

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });
}
