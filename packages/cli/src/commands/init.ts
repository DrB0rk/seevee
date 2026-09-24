/**
 * `seevee init [path]` — scaffold + validate + start + open + exit.
 *
 * Spec: `.dev/specs/CLI_INSTALLER.md` §4 (init), §5 (layout), §6 (agent
 * files), §7 (start), §8 (browser), §10 (exit codes).
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import type { CommandContext, CommandResult } from '../cli.js';
import { CliUsageError, LifecycleError } from '../cli.js';
import { EXIT } from '../cli.js';
import {
  discoverWorkspace,
  resolveAbsolutePath,
  workspaceAt,
  WorkspaceNotFoundError,
  type DiscoveredWorkspace,
} from '../runtime/workspace-discovery.js';
import { start, DaemonStartError } from '../runtime/daemon.js';
import { openInBrowser } from '../runtime/browser.js';
import { readWorkspaceId } from '../scaffold/create-workspace.js';
import { writeAgentFiles } from '../scaffold/agent-files.js';
import { validateResource } from './validate.js';

const SCHEMA_VERSION = '1.0.0';

export async function runInit(ctx: CommandContext): Promise<CommandResult> {
  const explicit = ctx.positional[0];
  const target = resolveAbsolutePath(explicit ?? process.cwd(), process.cwd());

  await ensureTargetDirectory(target);

  let ws: DiscoveredWorkspace;
  try {
    ws = await discoverWorkspace(target);
  } catch (err) {
    if (!(err instanceof WorkspaceNotFoundError)) throw err;
    ws = workspaceAt(target);
  }

  const marker = await fileExists(ws.workspaceFile);
  if (marker) {
    await migrateLegacyWorkspace(ws);
    await ensureDefaultTemplateRegistration(ws);
    await validateExistingWorkspace(ws);
  } else {
    await createFreshWorkspace(ws);
  }

  const agent = await writeAgentFiles(ws, { allowOverwrite: false });
  const preservedAgent =
    !agent.createdTopLevel && (await fileExists(path.join(ws.root, 'AGENTS.md')));

  const workspaceId = await readWorkspaceId(ws);
  const host = ctx.flags.host ?? '127.0.0.1';
  let reused = false;
  let url: string;
  let pid: number | undefined;
  try {
    const startOpts: Parameters<typeof start>[0] = {
      workspace: ws,
      workspaceId,
      host,
    };
    if (typeof ctx.flags.port === 'number') {
      startOpts.port = ctx.flags.port;
    }
    const started = await start(startOpts);
    reused = started.reused;
    url = `http://${started.state.host}:${started.state.port}`;
    pid = started.state.pid;
  } catch (err) {
    if (err instanceof DaemonStartError) {
      throw new LifecycleError(
        err.message + (err.logFile ? ' (see ' + err.logFile + ')' : ''),
      );
    }
    throw err;
  }

  let opened = false;
  if (!ctx.flags.noOpen) {
    opened = await openInBrowser(url);
  }

  const summary = [
    `workspace: ${ws.root}`,
    `workspaceId: ${workspaceId}`,
    `runtime: ${reused ? 'reused' : 'fresh'} (${url})`,
    `pid: ${pid}${reused ? ' (pre-existing)' : ''}`,
    `agentGuide: ${preservedAgent ? 'preserved existing AGENTS.md' : path.relative(ws.root, agent.readmePath)}`,
  ];
  if (!ctx.flags.noOpen) {
    summary.push(`browser: ${opened ? 'opened' : 'not launched (manual visit required)'}`);
  }

  return {
    ok: true,
    code: EXIT.SUCCESS,
    data: {
      workspace: ws.root,
      workspaceId,
      url,
      pid,
      reused,
      opened,
      preservedAgent,
    },
    message: ctx.flags.json
      ? undefined
      : `seevee init: done\n  ${summary.join('\n  ')}\n\nNext commands:\n  seevee start   — start/restart the dashboard\n  seevee stop    — stop the dashboard\n  seevee status  — check runtime\n  seevee doctor  — health check`,
  };
}

async function ensureTargetDirectory(target: string): Promise<void> {
  let stat;
  try {
    stat = await fs.stat(target);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      await fs.mkdir(target, { recursive: true });
      return;
    }
    throw err;
  }
  if (!stat.isDirectory()) {
    throw new CliUsageError(`init target is not a directory: ${target}`);
  }
}

async function fileExists(p: string): Promise<boolean> {
  try {
    const stat = await fs.stat(p);
    return stat.isFile();
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw err;
  }
}

async function validateExistingWorkspace(ws: DiscoveredWorkspace): Promise<void> {
  const resources = ['cvs', 'provenance', 'comments', 'presentations', 'templates'];
  for (const dir of resources) {
    const dirPath = path.join(ws.root, dir);
    let entries: string[];
    try {
      entries = await fs.readdir(dirPath);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') continue;
      throw err;
    }
    for (const entry of entries) {
      if (!entry.endsWith('.json')) continue;
      const file = path.join(dirPath, entry);
      const result = await validateResource({ file });
      if (!result.ok) {
        // init is permissive: surface the failure to the user but continue.
        process.stderr.write(
          `seevee: validation issue in ${path.relative(ws.root, file)}: ${result.message ?? 'invalid'}\n`,
        );
      }
    }
  }
}

async function createFreshWorkspace(ws: DiscoveredWorkspace): Promise<void> {
  await fs.mkdir(ws.root, { recursive: true });
  for (const d of [
    'cvs',
    'provenance',
    'comments',
    'presentations',
    'sources/raw',
    'sources/extracted',
    'templates/local',
    'exports',
    '.seevee/locks',
    '.seevee/logs',
    '.seevee/history',
    '.seevee/diagnostics',
  ]) {
    await fs.mkdir(path.join(ws.root, d), { recursive: true });
  }
  const documents = buildWorkspaceDocuments(path.basename(ws.root));
  await installDefaultTemplate(ws);
  await atomicWrite(ws.workspaceFile, JSON.stringify(documents.workspace, null, 2) + '\n');
  await atomicWrite(path.join(ws.root, 'cvs', 'main.json'), JSON.stringify(documents.cv, null, 2) + '\n');
  await atomicWrite(path.join(ws.root, 'provenance', 'main.json'), JSON.stringify(documents.provenance, null, 2) + '\n');
  await atomicWrite(path.join(ws.root, 'comments', 'main.json'), JSON.stringify(documents.comments, null, 2) + '\n');
  await atomicWrite(path.join(ws.root, 'presentations', 'main.json'), JSON.stringify(documents.presentation, null, 2) + '\n');
}

async function installDefaultTemplate(ws: DiscoveredWorkspace): Promise<void> {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const candidates = [
    process.env['SEEVEE_CLASSIC_TEMPLATE_DIR'],
    path.resolve(here, '../../../templates/classic/v1'),
    path.resolve(here, '../../../../templates/classic/v1'),
  ].filter((candidate): candidate is string => Boolean(candidate));
  for (const source of candidates) {
    try {
      if (!(await fs.stat(path.join(source, 'template.json'))).isFile()) continue;
      const destination = path.join(ws.root, 'templates/local/classic');
      await fs.mkdir(path.dirname(destination), { recursive: true });
      await fs.cp(source, destination, { recursive: true, force: false, errorOnExist: false });
      return;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw new LifecycleError(`Could not install the default Classic CV template: ${(error as Error).message}`);
      }
      // Try the source-checkout or bundled runtime location next.
    }
  }
  throw new LifecycleError('The default Classic CV template is missing from this Seevee installation. Reinstall Seevee and run `seevee init` again.');
}

async function ensureDefaultTemplateRegistration(ws: DiscoveredWorkspace): Promise<void> {
  let workspace: Record<string, unknown>;
  try {
    workspace = JSON.parse(await fs.readFile(ws.workspaceFile, 'utf8')) as Record<string, unknown>;
  } catch {
    return;
  }
  if (workspace.kind !== 'seevee.workspace' || !workspace.data || typeof workspace.data !== 'object') return;
  const data = workspace.data as Record<string, unknown>;
  if (!data.resources || typeof data.resources !== 'object') return;
  const resources = data.resources as Record<string, unknown>;
  await installDefaultTemplate(ws);
  if (!resources.templates || typeof resources.templates !== 'object') resources.templates = {};
  const templates = resources.templates as Record<string, unknown>;
  const now = new Date().toISOString();
  let changed = false;
  if (!templates.classic) {
    templates.classic = {
      id: 'classic',
      relativePath: 'templates/local/classic/template.json',
      currentVersionId: 'tplclassic0000000000000000001',
      updatedAt: now,
    };
    changed = true;
  }

  const presentations = resources.presentations;
  if (presentations && typeof presentations === 'object') {
    for (const entry of Object.values(presentations as Record<string, unknown>)) {
      if (!entry || typeof entry !== 'object') continue;
      const resource = entry as Record<string, unknown>;
      if (resource.templateId !== 'tpl_classic' && resource.versionId !== 'tpl_classic_v1') continue;
      if (typeof resource.relativePath !== 'string') continue;
      const file = path.resolve(ws.root, resource.relativePath);
      if (file === ws.root || !file.startsWith(`${ws.root}${path.sep}`)) continue;
      let document: Record<string, unknown>;
      try {
        document = JSON.parse(await fs.readFile(file, 'utf8')) as Record<string, unknown>;
      } catch {
        continue;
      }
      if (!document.data || typeof document.data !== 'object') continue;
      const presentationData = document.data as Record<string, unknown>;
      if (!presentationData.template || typeof presentationData.template !== 'object') continue;
      const selection = presentationData.template as Record<string, unknown>;
      selection.templateId = 'classic';
      selection.versionId = 'tplclassic0000000000000000001';
      document.revision = typeof document.revision === 'number' ? document.revision + 1 : 1;
      document.updatedAt = now;
      await atomicWrite(file, JSON.stringify(document, null, 2) + '\n');
      resource.templateId = 'classic';
      resource.versionId = 'tplclassic0000000000000000001';
      resource.revision = document.revision;
      resource.updatedAt = now;
      changed = true;
    }
  }

  if (changed) {
    workspace.revision = typeof workspace.revision === 'number' ? workspace.revision + 1 : 1;
    workspace.updatedAt = now;
    await atomicWrite(ws.workspaceFile, JSON.stringify(workspace, null, 2) + '\n');
  }
}

async function atomicWrite(file: string, content: string): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp-${process.pid}-${Date.now()}`;
  await fs.writeFile(tmp, content, 'utf8');
  await fs.rename(tmp, file);
}

function buildWorkspaceDocuments(name: string) {
  const stamp = new Date().toISOString();
  const workspaceId = `ws_local_${Date.now().toString(36)}`;
  const emptyResource = (kind: string, data: object) => ({
    kind,
    schemaVersion: SCHEMA_VERSION,
    id: 'main',
    revision: 1,
    createdAt: stamp,
    updatedAt: stamp,
    data,
  });
  const cv = emptyResource('seevee.cv', {
    locale: 'en-US',
    identity: {
      id: 'person_main',
      name: { display: 'Your name' },
      contact: [],
      headline: '',
      summary: '',
    },
    sectionOrder: ['sec_summary', 'sec_experience', 'sec_education', 'sec_skills'],
    sections: {
      sec_summary: { id: 'sec_summary', type: 'summary', title: 'Profile', visible: true, collapsible: false, defaultCollapsed: false },
      sec_experience: { id: 'sec_experience', type: 'experience', title: 'Experience', visible: true, collapsible: false, defaultCollapsed: false, nodeOrder: [] },
      sec_education: { id: 'sec_education', type: 'education', title: 'Education', visible: true, collapsible: false, defaultCollapsed: false, nodeOrder: [] },
      sec_skills: { id: 'sec_skills', type: 'skills', title: 'Skills', visible: true, collapsible: false, defaultCollapsed: false, nodeOrder: [] },
    },
    entities: {
      experience: {}, education: {}, projects: {}, skills: {}, skillGroups: {}, certifications: {},
      awards: {}, languages: {}, publications: {}, volunteering: {}, references: {}, organizations: {},
      roles: {}, bulletCollections: {}, custom: {},
    },
  });
  const presentation = emptyResource('seevee.presentation', {
    cvId: 'main',
    template: { templateId: 'classic', versionId: 'tplclassic0000000000000000001' },
    page: { preset: 'A4', orientation: 'portrait', edges: { top: 12, right: 12, bottom: 12, left: 12 } },
    pagination: { targetMin: 1, targetMax: 2, breakBehavior: 'auto' },
    tokens: {
      'accent-color': { type: 'color', value: '#1f2937' },
      'font-family': { type: 'string', value: 'Inter, system-ui, sans-serif' },
      'base-font-size': { type: 'number', value: 11 },
      'line-height': { type: 'number', value: 1.4 },
    },
    sectionOverrides: {},
    templateOverrides: {},
  });
  const cvEntry = { id: 'main', relativePath: 'cvs/main.json', revision: 1, updatedAt: stamp };
  const presentationEntry = {
    id: 'main', relativePath: 'presentations/main.json', templateId: 'classic', versionId: 'tplclassic0000000000000000001', revision: 1, updatedAt: stamp,
  };
  return {
    workspace: {
      kind: 'seevee.workspace', schemaVersion: SCHEMA_VERSION, id: workspaceId, revision: 1, createdAt: stamp, updatedAt: stamp,
      data: {
        name,
        active: { cvId: 'main', presentationId: 'main' },
        resources: {
          cvs: { main: cvEntry }, presentations: { main: presentationEntry },
          provenance: { main: { id: 'main', relativePath: 'provenance/main.json', cvId: 'main', revision: 1, updatedAt: stamp } },
          comments: { main: { id: 'main', relativePath: 'comments/main.json', cvId: 'main', revision: 1, updatedAt: stamp } },
          sources: {},
          templates: { classic: { id: 'classic', relativePath: 'templates/local/classic/template.json', currentVersionId: 'tplclassic0000000000000000001', updatedAt: stamp } },
          stylePresets: {}, changeSets: {}, agentRuns: {},
        },
        policy: { allowAgentFactInference: false, requireEvidenceForNumericClaims: true, allowForceExportWithOverflow: false, autoResolveDeterministicComments: true },
      },
    },
    cv,
    presentation,
    provenance: emptyResource('seevee.provenance', { sources: {}, assertions: {} }),
    comments: emptyResource('seevee.comments', { threadOrder: [], threads: {} }),
  };
}

async function migrateLegacyWorkspace(ws: DiscoveredWorkspace): Promise<void> {
  let raw: unknown;
  try {
    raw = JSON.parse(await fs.readFile(ws.workspaceFile, 'utf8')) as unknown;
  } catch {
    return;
  }
  if (!raw || typeof raw !== 'object' || !('type' in raw) || raw.type !== 'seevee.workspace' || !('data' in raw)) return;
  const legacy = raw as { id?: unknown; data?: { name?: unknown } };
  const backupRoot = path.join(ws.runtimeDir, 'migrations', `legacy-${Date.now()}`);
  const managed = [ws.workspaceFile, path.join(ws.root, 'cvs/main.json'), path.join(ws.root, 'presentations/main.json'), path.join(ws.root, 'comments/main.json'), path.join(ws.root, 'provenance/main.json')];
  await fs.mkdir(backupRoot, { recursive: true });
  for (const file of managed) {
    try {
      const backup = path.join(backupRoot, path.relative(ws.root, file));
      await fs.mkdir(path.dirname(backup), { recursive: true });
      await fs.copyFile(file, backup);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  }
  const name = typeof legacy.data?.name === 'string' && legacy.data.name.trim() ? legacy.data.name : path.basename(ws.root);
  const documents = buildWorkspaceDocuments(name);
  await installDefaultTemplate(ws);
  if (typeof legacy.id === 'string' && legacy.id.length > 2) documents.workspace.id = legacy.id;
  const existingCvPath = path.join(ws.root, 'cvs/main.json');
  try {
    const oldCv = JSON.parse(await fs.readFile(existingCvPath, 'utf8')) as { data?: { identity?: { name?: { display?: unknown }; fullName?: unknown; headline?: unknown; summary?: unknown; contactChannels?: unknown } } };
    const oldIdentity = oldCv.data?.identity;
    if (oldIdentity) {
      const identity = (documents.cv.data as unknown as { identity: { name: { display: string }; headline: string; summary: string; contact: Array<{ kind: string; value: string; primary?: boolean }> } }).identity;
      const display = oldIdentity.name?.display ?? oldIdentity.fullName;
      if (typeof display === 'string' && display.trim()) identity.name.display = display;
      if (typeof oldIdentity.headline === 'string') identity.headline = oldIdentity.headline;
      if (typeof oldIdentity.summary === 'string') identity.summary = oldIdentity.summary;
      if (Array.isArray(oldIdentity.contactChannels)) {
        identity.contact = oldIdentity.contactChannels.filter((entry): entry is { kind: string; value: string } =>
          !!entry && typeof entry === 'object' && 'kind' in entry && 'value' in entry && typeof entry.kind === 'string' && typeof entry.value === 'string',
        ).filter((entry) => ['email', 'phone', 'website', 'linkedin', 'github', 'mastodon', 'orcid', 'other'].includes(entry.kind)) as typeof identity.contact;
      }
    }
  } catch {
    // The archived file remains available if its legacy shape cannot be read.
  }
  await atomicWrite(ws.workspaceFile, JSON.stringify(documents.workspace, null, 2) + '\n');
  await atomicWrite(existingCvPath, JSON.stringify(documents.cv, null, 2) + '\n');
  await atomicWrite(path.join(ws.root, 'presentations/main.json'), JSON.stringify(documents.presentation, null, 2) + '\n');
  await atomicWrite(path.join(ws.root, 'comments/main.json'), JSON.stringify(documents.comments, null, 2) + '\n');
  await atomicWrite(path.join(ws.root, 'provenance/main.json'), JSON.stringify(documents.provenance, null, 2) + '\n');
}
