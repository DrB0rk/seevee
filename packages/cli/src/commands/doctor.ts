/**
 * `seevee doctor` — diagnose runtime / browser / schema / template problems.
 *
 * Spec: `.dev/specs/CLI_INSTALLER.md` §9 (doctor), §10 (--json flag), §14
 * (security defaults).
 */

import process from 'node:process';

import type { CommandContext, CommandResult } from '../cli.js';
import { RUNTIME_VERSION, SCHEMA_VERSION, VERSION } from '../cli.js';
import { discoverWorkspace, WorkspaceNotFoundError } from '../runtime/workspace-discovery.js';
import { isProcessAlive, readRuntimeState } from '../runtime/process-state.js';
import { DEFAULT_PREFERRED_PORT, findAvailablePort } from '../runtime/ports.js';

export interface DoctorCheck {
  id: string;
  label: string;
  ok: boolean;
  detail?: string;
  hint?: string;
}

export interface DoctorReport {
  cli: string;
  runtime: string;
  schema: string;
  node: string;
  platform: string;
  workspace: string | null;
  checks: DoctorCheck[];
  ok: boolean;
}

function nodeCheck(): DoctorCheck {
  const major = Number.parseInt(process.versions.node.split('.')[0] ?? '0', 10);
  if (major >= 20) {
    return {
      id: 'node',
      label: `Node.js ${process.versions.node}`,
      ok: true,
    };
  }
  return {
    id: 'node',
    label: `Node.js ${process.versions.node}`,
    ok: false,
    hint: 'Seevee requires Node ≥ 20.',
  };
}

function platformCheck(): DoctorCheck {
  return {
    id: 'platform',
    label: `${process.platform} ${process.arch}`,
    ok: true,
  };
}

async function portCheck(): Promise<DoctorCheck> {
  try {
    const port = await findAvailablePort('127.0.0.1', DEFAULT_PREFERRED_PORT);
    return {
      id: 'port',
      label: `loopback port ${port} is free`,
      ok: true,
    };
  } catch {
    return {
      id: 'port',
      label: `loopback port range [${DEFAULT_PREFERRED_PORT}, ${
        DEFAULT_PREFERRED_PORT + 100
      }] exhausted`,
      ok: false,
      hint: 'stop other services or pass --port to bound commands.',
    };
  }
}

async function workspaceCheck(
  positional: readonly string[],
  cwd: string,
): Promise<DoctorCheck> {
  try {
    const explicit = positional[0];
    const ws = await discoverWorkspace(explicit, cwd);
    return {
      id: 'workspace',
      label: `workspace at ${ws.root}`,
      ok: true,
      detail: `seevee.json present`,
    };
  } catch (err) {
    if (err instanceof WorkspaceNotFoundError) {
      return {
        id: 'workspace',
        label: 'workspace not initialised',
        ok: false,
        hint: 'run `seevee init` in your CV directory.',
      };
    }
    throw err;
  }
}

async function runtimeCheck(
  positional: readonly string[],
  cwd: string,
): Promise<DoctorCheck> {
  try {
    const explicit = positional[0];
    const ws = await discoverWorkspace(explicit, cwd);
    const state = await readRuntimeState(ws.runtimeStateFile);
    if (state === null) {
      return {
        id: 'runtime',
        label: 'dashboard server not running',
        ok: true,
        detail: 'no runtime.json',
      };
    }
    const alive = await isProcessAlive(state.pid);
    return {
      id: 'runtime',
      label: alive
        ? `dashboard running at http://${state.host}:${state.port}/`
        : `stale runtime.json (pid ${state.pid} not alive)`,
      ok: alive,
      hint: alive ? undefined : 'run `seevee start`.',
    };
  } catch (err) {
    if (err instanceof WorkspaceNotFoundError) {
      return {
        id: 'runtime',
        label: 'workspace not initialised',
        ok: false,
        hint: 'run `seevee init` first.',
      };
    }
    throw err;
  }
}

function schemaVersionCheck(): DoctorCheck {
  return {
    id: 'schema-version',
    label: `schema ${SCHEMA_VERSION}, cli ${VERSION}, runtime ${RUNTIME_VERSION}`,
    ok: true,
  };
}

export async function runDoctor(ctx: CommandContext): Promise<CommandResult> {
  const checks: DoctorCheck[] = [];
  checks.push(nodeCheck());
  checks.push(platformCheck());
  checks.push(schemaVersionCheck());
  checks.push(await portCheck());

  let workspacePath: string | null = null;
  try {
    const explicit = ctx.positional[0];
    const ws = await discoverWorkspace(explicit, ctx.cwd);
    workspacePath = ws.root;
  } catch {
    workspacePath = null;
  }
  checks.push(await workspaceCheck(ctx.positional, ctx.cwd));
  checks.push(await runtimeCheck(ctx.positional, ctx.cwd));

  const report: DoctorReport = {
    cli: VERSION,
    runtime: RUNTIME_VERSION,
    schema: SCHEMA_VERSION,
    node: process.versions.node,
    platform: `${process.platform} ${process.arch}`,
    workspace: workspacePath,
    checks,
    ok: checks.every((c) => c.ok),
  };

  const summary = report.ok
    ? `seevee doctor: ok (${checks.length} checks)`
    : `seevee doctor: ${checks.filter((c) => !c.ok).length} issue(s)`;

  return {
    ok: report.ok,
    code: report.ok ? 0 : 1,
    data: report,
    message: ctx.flags.json
      ? undefined
      : [
          summary,
          ...checks.map((c) =>
            `  [${c.ok ? 'OK' : 'FAIL'}] ${c.label}${c.hint ? ` — ${c.hint}` : ''}`,
          ),
        ].join('\n'),
  };
}
