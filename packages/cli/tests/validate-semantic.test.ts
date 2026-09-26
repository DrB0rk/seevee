import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { parseArgs, type CommandContext, type GlobalFlags } from '../src/cli.js';
import { runValidate } from '../src/commands/validate.js';

/**
 * `seevee validate` is the check the agent instructions tell every agent to
 * run before reporting a change complete. Its semantic pass used to look for
 * `cvs/main.json` and friends, which no workspace has, so it silently checked
 * nothing and reported success on broken workspaces. These lock that shut,
 * using the real studio fixture documents rather than hand-rolled ones.
 */
const FIXTURE = path.resolve(import.meta.dirname, '..', '..', '..', 'apps', 'studio', 'tests', 'fixtures', 'workspace');

let root = '';

function context(cwd: string): CommandContext {
  const parsed = parseArgs(['validate', '--json']);
  return { rawArgs: [], positional: parsed.positional, flags: parsed.flags as GlobalFlags, cwd };
}

/** Copy the real fixture workspace, optionally dangling one provenance target. */
async function copyFixture(danglingTarget?: string): Promise<void> {
  for (const dir of ['cvs', 'presentations', 'provenance', 'comments', 'sources']) {
    await fs.cp(path.join(FIXTURE, dir), path.join(root, dir), { recursive: true });
  }
  const marker = JSON.parse(await fs.readFile(path.join(FIXTURE, 'seevee.json'), 'utf8')) as {
    data: { resources: Record<string, Record<string, { relativePath: string }>> };
  };
  await fs.writeFile(path.join(root, 'seevee.json'), JSON.stringify(marker, null, 2));
  if (danglingTarget === undefined) return;

  const provenancePath = path.join(root, marker.data.resources['provenance']!['prov_test']!.relativePath);
  const provenance = JSON.parse(await fs.readFile(provenancePath, 'utf8')) as {
    data: { assertions: Record<string, { target: { nodeId?: string } }> };
  };
  const [first] = Object.keys(provenance.data.assertions);
  provenance.data.assertions[first!]!.target.nodeId = danglingTarget;
  await fs.writeFile(provenancePath, JSON.stringify(provenance, null, 2));
}

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'seevee-validate-'));
});

afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

describe('seevee validate semantic pass', () => {
  it('passes on a healthy workspace', async () => {
    await copyFixture();
    const result = await runValidate(context(root));
    expect(result.ok).toBe(true);
    const data = result.data as { semantic: unknown[]; files: unknown[] };
    expect(data.semantic).toEqual([]);
    expect(data.files.length).toBeGreaterThan(0);
  });

  it('reports a dangling provenance target instead of claiming success', async () => {
    await copyFixture('exp_that_does_not_exist');
    await expect(runValidate(context(root))).rejects.toThrow(/validation issue/);
  });

  it('still structurally validates every registered file', async () => {
    await copyFixture();
    const result = await runValidate(context(root));
    const files = (result.data as { files: { kind: string }[] }).files;
    const kinds = new Set(files.map((file) => file.kind));
    expect(kinds.has('cv')).toBe(true);
    expect(kinds.has('presentation')).toBe(true);
    expect(kinds.has('provenance')).toBe(true);
  });
});
