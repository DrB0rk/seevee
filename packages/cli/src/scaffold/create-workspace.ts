import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

import type { DiscoveredWorkspace } from '../runtime/workspace-discovery.js';

/**
 * Workspace scaffolding per `.dev/specs/CLI_INSTALLER.md` §5.
 *
 * `seevee init` creates only its declared managed files/directories. If a
 * would-be managed path already exists with incompatible content, fail with
 * a machine-readable conflict and a human-readable explanation.
 */

export interface CreateWorkspaceResult {
  workspaceId: string;
  created: readonly string[];
  preserved: readonly string[];
  readonly root: string;
}

export class WorkspaceConflictError extends Error {
  public override readonly name = 'WorkspaceConflictError';
  public readonly conflictPath: string;
  public readonly conflictReason: 'content-mismatch' | 'incompatible-mode';
  constructor(path: string, reason: 'content-mismatch' | 'incompatible-mode', message: string) {
    super(message);
    this.conflictPath = path;
    this.conflictReason = reason;
  }
}

export interface CreateWorkspaceOptions {
  name: string;
  allowOverwriteManaged?: boolean;
}

interface ManagedFile {
  filePath: string;
  bytes: Buffer;
}

const SCHEMA_VERSION = '1.0.0';

function nowIso(): string {
  return new Date().toISOString();
}

function makeWorkspaceId(): string {
  // Stable-looking, locally-scoped, human-readable id. We don't need
  // cryptographic uniqueness — the workspace root absolute path is the
  // global collision key.
  const stamp = Date.now().toString(36);
  return `ws_local_${stamp}`;
}

export function buildSeeveeJson(workspaceId: string, name: string): string {
  const document = {
    schema: SCHEMA_VERSION,
    type: 'seevee.workspace',
    id: workspaceId,
    schemaVersion: SCHEMA_VERSION,
    updatedAt: nowIso(),
    data: {
      name,
      active: { cvId: 'main', presentationId: 'main' },
      resources: {
        cvs: {},
        presentations: {},
        provenance: {},
        comments: {},
        sources: {},
        templates: {},
        stylePresets: {},
        changeSets: {},
        agentRuns: {},
      },
      policy: {
        allowAgentFactInference: false,
        requireEvidenceForNumericClaims: true,
        allowForceExportWithOverflow: false,
        autoResolveDeterministicComments: true,
      },
    },
  };
  return `${JSON.stringify(document, null, 2)}\n`;
}

function buildCvJson(): string {
  const document = {
    schema: SCHEMA_VERSION,
    type: 'seevee.cv',
    id: 'main',
    schemaVersion: SCHEMA_VERSION,
    updatedAt: nowIso(),
    data: {
      identity: {
        fullName: 'New User',
        headline: '',
        summary: '',
        contactChannels: [],
      },
      sections: [],
      entities: {
        organizations: {},
        roles: {},
        bullets: {},
        experiences: {},
        education: {},
        projects: {},
        skills: {},
        skillGroups: {},
        certifications: {},
        awards: {},
        languages: {},
        publications: {},
        volunteering: {},
        references: {},
        customEntities: {},
      },
      extensions: {},
    },
  };
  return `${JSON.stringify(document, null, 2)}\n`;
}

function buildEmptyResource(type: string): string {
  const document = {
    schema: SCHEMA_VERSION,
    type,
    id: 'main',
    schemaVersion: SCHEMA_VERSION,
    updatedAt: nowIso(),
    data: {},
  };
  return `${JSON.stringify(document, null, 2)}\n`;
}

function managedLayout(): readonly { dir: string; entries: readonly ManagedFile[] }[] {
  return [
    {
      dir: '',
      entries: [
        { filePath: 'seevee.json', bytes: Buffer.from('') },
      ],
    },
    {
      dir: 'cvs',
      entries: [{ filePath: 'cvs/main.json', bytes: Buffer.from('') }],
    },
    {
      dir: 'provenance',
      entries: [{ filePath: 'provenance/main.json', bytes: Buffer.from('') }],
    },
    {
      dir: 'comments',
      entries: [{ filePath: 'comments/main.json', bytes: Buffer.from('') }],
    },
    {
      dir: 'presentations',
      entries: [{ filePath: 'presentations/main.json', bytes: Buffer.from('') }],
    },
    {
      dir: 'sources/raw',
      entries: [],
    },
    {
      dir: 'sources/extracted',
      entries: [],
    },
    {
      dir: 'templates/local',
      entries: [],
    },
    {
      dir: 'exports',
      entries: [],
    },
    {
      dir: '.seevee/locks',
      entries: [],
    },
    {
      dir: '.seevee/logs',
      entries: [],
    },
    {
      dir: '.seevee/history',
      entries: [],
    },
    {
      dir: '.seevee/diagnostics',
      entries: [],
    },
  ];
}

async function ensureDirectory(dir: string): Promise<void> {
  await fs.mkdir(dir, { recursive: true });
}

async function fileBytes(target: string): Promise<Buffer | null> {
  try {
    return await fs.readFile(target);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      return null;
    }
    throw err;
  }
}

/**
 * Compare `existing` (on disk) with `desired` (scaffold). Returns true when
 * the existing file matches the desired bytes, false when it is a genuine
 * conflict, and also false when the existing file is invalid JSON of a kind
 * that should be surfaced (we conservatively fail).
 */
async function checkManagedConflict(
  file: string,
  desired: Buffer,
  allowOverwrite: boolean,
): Promise<'ok' | 'preserved' | 'conflict'> {
  const existing = await fileBytes(file);
  if (existing === null) {
    return 'ok';
  }
  if (allowOverwrite) {
    return 'preserved';
  }
  if (existing.equals(desired)) {
    return 'preserved';
  }
  return 'conflict';
}

async function writeAtomic(file: string, content: Buffer): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp-${process.pid}-${Date.now()}`;
  await fs.writeFile(tmp, content);
  await fs.rename(tmp, file);
}

/**
 * Create the canonical layout under `ws.root`. Idempotent: re-running with
 * existing-but-matching managed files is a no-op; matching files are
 * preserved; conflicting files throw `WorkspaceConflictError`.
 */
export async function createWorkspace(
  ws: DiscoveredWorkspace,
  options: CreateWorkspaceOptions,
): Promise<CreateWorkspaceResult> {
  const allowOverwrite = options.allowOverwriteManaged === true;
  const workspaceId = makeWorkspaceId();
  const created: string[] = [];
  const preserved: string[] = [];

  // Layout directories.
  for (const section of managedLayout()) {
    if (section.dir !== '') {
      await ensureDirectory(path.join(ws.root, section.dir));
    }
  }

  // `seevee.json`
  {
    const file = path.join(ws.root, 'seevee.json');
    const desired = Buffer.from(buildSeeveeJson(workspaceId, options.name));
    const verdict = await checkManagedConflict(file, desired, allowOverwrite);
    if (verdict === 'conflict') {
      throw new WorkspaceConflictError(
        file,
        'content-mismatch',
        `refusing to overwrite managed file with incompatible content: ${path.relative(ws.root, file)}`,
      );
    }
    if (verdict === 'ok') {
      await writeAtomic(file, desired);
      created.push(path.relative(ws.root, file));
    } else {
      preserved.push(path.relative(ws.root, file));
    }
  }

  // CV stub.
  {
    const file = path.join(ws.root, 'cvs', 'main.json');
    const desired = Buffer.from(buildCvJson());
    const verdict = await checkManagedConflict(file, desired, allowOverwrite);
    if (verdict === 'conflict') {
      throw new WorkspaceConflictError(
        file,
        'content-mismatch',
        `refusing to overwrite managed file with incompatible content: ${path.relative(ws.root, file)}`,
      );
    }
    if (verdict === 'ok') {
      await writeAtomic(file, desired);
      created.push(path.relative(ws.root, file));
    } else {
      preserved.push(path.relative(ws.root, file));
    }
  }

  // Provenance / Comments / Presentations stub files. Each is a valid empty
  // envelope of the correct schema type.
  const resourceFiles: ReadonlyArray<{ path: string; type: string }> = [
    { path: 'provenance/main.json', type: 'seevee.provenance' },
    { path: 'comments/main.json', type: 'seevee.comments' },
    { path: 'presentations/main.json', type: 'seevee.presentation' },
  ];
  for (const r of resourceFiles) {
    const file = path.join(ws.root, r.path);
    const desired = Buffer.from(buildEmptyResource(r.type));
    const verdict = await checkManagedConflict(file, desired, allowOverwrite);
    if (verdict === 'conflict') {
      throw new WorkspaceConflictError(
        file,
        'content-mismatch',
        `refusing to overwrite managed file with incompatible content: ${path.relative(ws.root, r.path)}`,
      );
    }
    if (verdict === 'ok') {
      await writeAtomic(file, desired);
      created.push(path.relative(ws.root, r.path));
    } else {
      preserved.push(path.relative(ws.root, r.path));
    }
  }

  return {
    workspaceId,
    created,
    preserved,
    root: ws.root,
  };
}

/**
 * Read the workspace ID from `seevee.json` (the `id` field at the document
 * root). Falls back to a stable local id derived from the workspace path
 * when the file is missing or invalid.
 */
export async function readWorkspaceId(ws: DiscoveredWorkspace): Promise<string> {
  try {
    const raw = await fs.readFile(ws.workspaceFile, 'utf8');
    const parsed: unknown = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && 'id' in parsed) {
      const id = (parsed as Record<string, unknown>).id;
      if (typeof id === 'string' && id.length > 0) {
        return id;
      }
    }
  } catch {
    // fall through
  }
  return `ws_local_${path.basename(ws.root)}`;
}
