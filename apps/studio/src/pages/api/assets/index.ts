import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import type { APIRoute } from 'astro';
import { loadWorkspaceContext } from '../../../lib/workspace.js';

export const prerender = false;

const INDEX_PATH = 'sources/uploads/index.json';
const MAX_FILE_SIZE = 20 * 1024 * 1024;
const ALLOWED_EXTENSIONS = new Set([
  '.pdf', '.png', '.jpg', '.jpeg', '.webp', '.gif', '.docx', '.txt', '.md', '.rtf', '.odt', '.json', '.csv',
]);
const PURPOSES = new Set(['profile-photo', 'reference-cv', 'certificate', 'portfolio', 'other']);

interface WorkspaceAsset {
  id: string;
  name: string;
  relativePath: string;
  purpose: string;
  contentType: string;
  size: number;
  uploadedAt: string;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}

function safeName(name: string): string {
  const base = path.basename(name).normalize('NFKC').replace(/[^\p{L}\p{N}._-]+/gu, '-').replace(/^-+|-+$/g, '');
  return base.slice(-120) || 'upload';
}

async function readIndex(root: string): Promise<WorkspaceAsset[]> {
  try {
    const parsed: unknown = JSON.parse(await fs.readFile(path.join(root, INDEX_PATH), 'utf8'));
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((entry): entry is WorkspaceAsset =>
      typeof entry === 'object' && entry !== null &&
      typeof (entry as WorkspaceAsset).id === 'string' &&
      typeof (entry as WorkspaceAsset).name === 'string' &&
      typeof (entry as WorkspaceAsset).relativePath === 'string' &&
      typeof (entry as WorkspaceAsset).purpose === 'string',
    );
  } catch {
    return [];
  }
}

async function writeIndex(root: string, assets: WorkspaceAsset[]): Promise<void> {
  const indexFile = path.join(root, INDEX_PATH);
  const temporary = `${indexFile}.${randomUUID()}.tmp`;
  await fs.mkdir(path.dirname(indexFile), { recursive: true });
  await fs.writeFile(temporary, `${JSON.stringify(assets, null, 2)}\n`, 'utf8');
  await fs.rename(temporary, indexFile);
}

function isSameOrigin(request: Request): boolean {
  const origin = request.headers.get('origin');
  if (!origin) return true;
  try { return new URL(origin).host === new URL(request.url).host; } catch { return false; }
}

export const GET: APIRoute = async () => {
  const ctx = await loadWorkspaceContext();
  return json(await readIndex(ctx.root));
};

export const POST: APIRoute = async ({ request }) => {
  if (!isSameOrigin(request)) return json({ error: 'Cross-origin upload rejected.' }, 403);
  let form: FormData;
  try { form = await request.formData(); } catch { return json({ error: 'Could not read uploaded files.' }, 400); }
  const purposeValue = form.get('purpose');
  const purpose = typeof purposeValue === 'string' && PURPOSES.has(purposeValue) ? purposeValue : 'other';
  const files = form.getAll('files').filter((entry): entry is File => entry instanceof File && entry.size > 0);
  if (files.length === 0) return json({ error: 'Choose at least one file to upload.' }, 400);
  if (files.length > 20) return json({ error: 'Upload up to 20 files at a time.' }, 400);
  for (const file of files) {
    if (file.size > MAX_FILE_SIZE) return json({ error: `${file.name} is larger than 20 MB.` }, 413);
    if (!ALLOWED_EXTENSIONS.has(path.extname(file.name).toLowerCase())) {
      return json({ error: `${file.name} has an unsupported file type.` }, 415);
    }
  }

  const ctx = await loadWorkspaceContext();
  const assets = await readIndex(ctx.root);
  const directory = path.join(ctx.root, 'sources', 'uploads');
  await fs.mkdir(directory, { recursive: true });
  const uploadedAt = new Date().toISOString();
  const added: WorkspaceAsset[] = [];
  for (const file of files) {
    const id = `asset_${randomUUID().replace(/-/g, '')}`;
    const name = safeName(file.name);
    const relativePath = `sources/uploads/${id}-${name}`;
    const destination = path.join(ctx.root, relativePath);
    await fs.writeFile(destination, Buffer.from(await file.arrayBuffer()), { flag: 'wx' });
    added.push({ id, name: file.name, relativePath, purpose, contentType: file.type || 'application/octet-stream', size: file.size, uploadedAt });
  }
  const updated = [...assets, ...added];
  await writeIndex(ctx.root, updated);
  return json({ assets: updated, added }, 201);
};
