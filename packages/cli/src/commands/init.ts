/**
 * `seevee init [path]` — scaffold + validate + start + open + exit.
 *
 * Spec: `.dev/specs/CLI_INSTALLER.md` §4 (init), §5 (layout), §6 (agent
 * files), §7 (start), §8 (browser), §10 (exit codes).
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

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
  const resources = ['cvs', 'provenance', 'comments', 'presentations'];
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
  await atomicWrite(ws.workspaceFile, JSON.stringify(documents.workspace, null, 2) + '\n');
  await atomicWrite(path.join(ws.root, 'cvs', 'main.json'), JSON.stringify(documents.cv, null, 2) + '\n');
  await atomicWrite(path.join(ws.root, 'provenance', 'main.json'), JSON.stringify(documents.provenance, null, 2) + '\n');
  await atomicWrite(path.join(ws.root, 'comments', 'main.json'), JSON.stringify(documents.comments, null, 2) + '\n');
  await atomicWrite(path.join(ws.root, 'presentations', 'main.json'), JSON.stringify(documents.presentation, null, 2) + '\n');
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
    template: { templateId: 'tpl_classic', versionId: 'tpl_classic_v1' },
    page: { preset: 'A4', orientation: 'portrait', edges: { top: 12, right: 12, bottom: 12, left: 12 } },
    pagination: { targetMin: 1, targetMax: 2, breakBehavior: 'auto' },
    tokens: {},
    sectionOverrides: {},
    templateOverrides: {},
  });
  const cvEntry = { id: 'main', relativePath: 'cvs/main.json', revision: 1, updatedAt: stamp };
  const presentationEntry = {
    id: 'main', relativePath: 'presentations/main.json', templateId: 'tpl_classic', versionId: 'tpl_classic_v1', revision: 1, updatedAt: stamp,
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
          sources: {}, templates: {}, stylePresets: {}, changeSets: {}, agentRuns: {},
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
