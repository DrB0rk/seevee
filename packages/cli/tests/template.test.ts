import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { parseArgs, type CommandContext, type GlobalFlags } from '../src/cli.js';
import { runTemplate } from '../src/commands/template.js';

const REPO_ROOT = path.resolve(import.meta.dirname, '..', '..', '..');
const CLASSIC_TEMPLATE = path.join(REPO_ROOT, 'templates', 'classic', 'v1');

let root = '';

function context(argv: readonly string[]): CommandContext {
  const parsed = parseArgs(['template', ...argv]);
  return {
    rawArgs: argv,
    positional: parsed.positional,
    flags: parsed.flags as GlobalFlags,
    cwd: root,
  };
}

/** Copy a real repository template into a throwaway workspace. */
async function copyTemplate(from: string, to: string): Promise<number> {
  let copied = 0;
  const entries = await fs.readdir(from, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;
    const source = path.join(from, entry.name);
    const target = path.join(to, entry.name);
    if (entry.isDirectory()) {
      copied += await copyTemplate(source, target);
    } else if (entry.isFile()) {
      await fs.mkdir(path.dirname(target), { recursive: true });
      await fs.copyFile(source, target);
      copied += 1;
    }
  }
  return copied;
}

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'seevee-template-'));
  await copyTemplate(CLASSIC_TEMPLATE, path.join(root, 'templates', 'classic', 'version1'));
  await fs.writeFile(path.join(root, 'seevee.json'), `${JSON.stringify({
    kind: 'seevee.workspace',
    schemaVersion: '1.0.0',
    id: 'ws_test',
    revision: 1,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    data: {
      name: 'Template Test',
      active: { cvId: 'cv_artist', presentationId: 'pres_artist' },
      policy: {
        allowAgentFactInference: false,
        requireEvidenceForNumericClaims: true,
        allowForceExportWithOverflow: false,
        autoResolveDeterministicComments: false,
      },
      extensions: {},
      resources: {
        cvs: {},
        presentations: {},
        provenance: {},
        comments: {},
        sources: {},
        templates: {
          classic: { id: 'classic', relativePath: 'templates/classic/version1', currentVersionId: 'version1', updatedAt: '2026-01-01T00:00:00.000Z' },
        },
        stylePresets: {},
        changeSets: {},
        agentRuns: {},
      },
    },
  }, null, 2)}\n`);
});

afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

describe('seevee template lifecycle', () => {
  it('lists the active version and its stylesheet', async () => {
    const result = await runTemplate(context(['list', '--json']));
    expect(result.ok).toBe(true);
    const data = result.data as { templates: { id: string; currentVersionId: string; styleSheet: string }[] };
    expect(data.templates).toEqual([
      { id: 'classic', currentVersionId: 'version1', relativePath: 'templates/classic/version1', styleSheet: 'templates/classic/version1/styles/dashboard.css' },
    ]);
  });

  it('seeds a draft from the active version without touching the active one', async () => {
    const result = await runTemplate(context(['draft', '--template', 'classic', '--json']));
    expect(result.ok).toBe(true);
    const data = result.data as { draftId: string; draftRoot: string; styleSheet: string; files: number };
    expect(data.draftId).toBe('version2');
    expect(data.styleSheet).toBe(path.join(root, 'templates', 'classic', 'version2', 'styles', 'dashboard.css'));
    expect(data.files).toBeGreaterThan(3);
    await expect(fs.readFile(path.join(data.draftRoot, 'styles', 'dashboard.css'), 'utf8')).resolves.toContain(':scope');
    const workspace = JSON.parse(await fs.readFile(path.join(root, 'seevee.json'), 'utf8')) as { data: { resources: { templates: Record<string, { currentVersionId: string }> } } };
    expect(workspace.data.resources.templates['classic']?.currentVersionId).toBe('version1');
  });

  it('allocates the next free draft id and refuses to overwrite one', async () => {
    const first = await runTemplate(context(['draft', '--template', 'classic', '--json']));
    expect((first.data as { draftId: string }).draftId).toBe('version2');
    const second = await runTemplate(context(['draft', '--template', 'classic', '--json']));
    expect((second.data as { draftId: string }).draftId).toBe('version3');
    await expect(runTemplate(context(['draft', '--template', 'classic', '--draft', 'version3']))).rejects.toThrow(/already exists/);
  });

  it('validates a draft and reports a manifest that belongs to another template', async () => {
    await runTemplate(context(['draft', '--template', 'classic']));
    const good = await runTemplate(context(['validate', '--template', 'classic', '--draft', 'version2', '--json']));
    expect(good.ok).toBe(true);
    const data = good.data as { scannedFiles: number; manifestValid: boolean };
    expect(data.manifestValid).toBe(true);
    expect(data.scannedFiles).toBeGreaterThan(0);

    const manifestPath = path.join(root, 'templates', 'classic', 'version2', 'template.json');
    const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8')) as Record<string, unknown>;
    await fs.writeFile(manifestPath, JSON.stringify({ ...manifest, templateId: 'other' }, null, 2));
    const bad = await runTemplate(context(['validate', '--template', 'classic', '--draft', 'version2', '--json']));
    expect(bad.ok).toBe(true);
    expect(bad.message).toContain("manifest declares templateId 'other'");
  });

  it('activates a draft and repoints the workspace at it', async () => {
    await runTemplate(context(['draft', '--template', 'classic']));
    await fs.writeFile(path.join(root, 'templates', 'classic', 'version2', 'styles', 'dashboard.css'), ':scope { color: red; }\n');
    const result = await runTemplate(context(['activate', '--template', 'classic', '--draft', 'version2', '--json']));
    expect(result.ok).toBe(true);
    const workspace = JSON.parse(await fs.readFile(path.join(root, 'seevee.json'), 'utf8')) as { data: { resources: { templates: Record<string, { currentVersionId: string; relativePath: string }> } } };
    expect(workspace.data.resources.templates['classic']).toMatchObject({
      currentVersionId: 'version2',
      relativePath: 'templates/classic/version2',
    });
  });

  it('refuses to activate a draft with a broken manifest', async () => {
    await runTemplate(context(['draft', '--template', 'classic']));
    await fs.writeFile(path.join(root, 'templates', 'classic', 'version2', 'template.json'), '{ not json');
    await expect(runTemplate(context(['activate', '--template', 'classic', '--draft', 'version2']))).rejects.toThrow();
    const workspace = JSON.parse(await fs.readFile(path.join(root, 'seevee.json'), 'utf8')) as { data: { resources: { templates: Record<string, { currentVersionId: string }> } } };
    expect(workspace.data.resources.templates['classic']?.currentVersionId).toBe('version1');
  });

  it('is a no-op when the requested draft is already active', async () => {
    const result = await runTemplate(context(['activate', '--template', 'classic', '--json']));
    expect(result.ok).toBe(true);
    expect(result.data).toMatchObject({ changed: false, activatedVersionId: 'version1' });
  });

  it('compiles a draft against its own fixtures', async () => {
    await runTemplate(context(['draft', '--template', 'classic']));
    const result = await runTemplate(context(['compile', '--template', 'classic', '--draft', 'version2', '--json']));
    expect(result.ok).toBe(true);
    const data = result.data as { artifactId: string; pages: number };
    expect(data.artifactId.length).toBeGreaterThan(0);
    expect(data.pages).toBeGreaterThan(0);
  }, 120_000);

  it('rejects an unknown template', async () => {
    await expect(runTemplate(context(['draft', '--template', 'nope']))).rejects.toThrow(/not registered/);
  });
});
