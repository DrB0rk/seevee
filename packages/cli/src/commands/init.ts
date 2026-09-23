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
  await atomicWrite(ws.workspaceFile, buildWorkspaceStub(path.basename(ws.root)));
  await atomicWrite(path.join(ws.root, 'cvs', 'main.json'), buildResourceStub('seevee.cv'));
  await atomicWrite(path.join(ws.root, 'provenance', 'main.json'), buildResourceStub('seevee.provenance'));
  await atomicWrite(path.join(ws.root, 'comments', 'main.json'), buildResourceStub('seevee.comments'));
  await atomicWrite(path.join(ws.root, 'presentations', 'main.json'), buildResourceStub('seevee.presentation'));
}

async function atomicWrite(file: string, content: string): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp-${process.pid}-${Date.now()}`;
  await fs.writeFile(tmp, content, 'utf8');
  await fs.rename(tmp, file);
}

function buildWorkspaceStub(name: string): string {
  const stamp = new Date().toISOString();
  const workspaceId = `ws_local_${Date.now().toString(36)}`;
  const doc = {
    schema: SCHEMA_VERSION,
    type: 'seevee.workspace',
    id: workspaceId,
    schemaVersion: SCHEMA_VERSION,
    updatedAt: stamp,
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
      extensions: {},
    },
  };
  return `${JSON.stringify(doc, null, 2)}\n`;
}

function buildResourceStub(type: string): string {
  const doc = {
    schema: SCHEMA_VERSION,
    type,
    id: 'main',
    schemaVersion: SCHEMA_VERSION,
    updatedAt: new Date().toISOString(),
    data: {},
  };
  return `${JSON.stringify(doc, null, 2)}\n`;
}
