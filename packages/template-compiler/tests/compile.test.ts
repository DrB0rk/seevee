import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

import { templateManifestDocumentSchema } from '@seevee/schema';
import type { TemplateManifestDocument } from '@seevee/schema';

import {
  compileTemplate,
  CompileError,
  ManifestError,
  PolicyError,
  RenderError,
  canonicalJson,
  computeArtifactId,
  validateManifest,
} from '../src/index.js';

const HERE = dirname(new URL(import.meta.url).pathname);
const MINIMAL_TEMPLATE = resolve(HERE, 'fixtures/minimal-template');

let workspace: string;

beforeEach(() => {
  workspace = mkdtempSync(join(tmpdir(), 'seevee-compile-'));
});

afterEach(() => {
  rmSync(workspace, { recursive: true, force: true });
});

function loadMinimalManifest(): TemplateManifestDocument {
  const text = readFileSync(join(MINIMAL_TEMPLATE, 'template.json'), 'utf8');
  return templateManifestDocumentSchema.parse(JSON.parse(text));
}

describe('validateManifest', () => {
  it('rejects an invalid manifest (missing engine field)', () => {
    expect(() => validateManifest({ kind: 'seevee.template-manifest' })).toThrow(ManifestError);
  });

  it('accepts the minimal-template manifest', () => {
    const manifest = loadMinimalManifest();
    expect(() => validateManifest(manifest)).not.toThrow();
  });
});

describe('compileTemplate: minimal fixture (happy path)', () => {
  it('produces an artifact + writes compile-metadata.json', async () => {
    const manifest = loadMinimalManifest();
    const outputRoot = join(workspace, 'artifacts');

    const result = await compileTemplate({
      sourceRoot: MINIMAL_TEMPLATE,
      manifest,
      fixtureDir: join(MINIMAL_TEMPLATE, 'fixtures'),
      outputRoot,
    });

    expect(result.artifactId).toMatch(/^[a-f0-9]{64}$/);
    expect(result.manifestHash).toMatch(/^[a-f0-9]{64}$/);
    expect(result.pages).toBe(1);
    expect(result.hasOverflow).toBe(false);

    const artifactDir = join(outputRoot, result.artifactId);
    expect(existsSync(join(artifactDir, 'compile-metadata.json'))).toBe(true);
    expect(existsSync(join(artifactDir, 'template.json'))).toBe(true);
    expect(existsSync(join(artifactDir, 'src/Resume.astro'))).toBe(true);

    const metadata = JSON.parse(
      readFileSync(join(artifactDir, 'compile-metadata.json'), 'utf8'),
    ) as {
      artifactId: string;
      manifestHash: string;
      compiledAt: string;
      diagnostics: Array<{ stage: string; level: string; message: string }>;
    };

    expect(metadata.artifactId).toBe(result.artifactId);
    expect(metadata.manifestHash).toBe(result.manifestHash);
    expect(typeof metadata.compiledAt).toBe('string');

    const stages = new Set(metadata.diagnostics.map((d) => d.stage));
    expect(stages.has('policy-scan')).toBe(true);
    expect(stages.has('manifest-validation')).toBe(true);
    expect(stages.has('type-check')).toBe(true);
    expect(stages.has('fixture-render')).toBe(true);
    expect(stages.has('layout-diag')).toBe(true);
    expect(stages.has('artifact-write')).toBe(true);

    // Every recorded stage is either pass or skipped (no fail).
    for (const diag of metadata.diagnostics) {
      expect(['pass', 'skipped']).toContain(diag.level);
    }
  });

  it('produces a deterministic artifactId for identical source', async () => {
    const manifest = loadMinimalManifest();
    const outputRoot = join(workspace, 'artifacts');
    const first = await compileTemplate({
      sourceRoot: MINIMAL_TEMPLATE,
      manifest,
      fixtureDir: join(MINIMAL_TEMPLATE, 'fixtures'),
      outputRoot,
    });
    const second = await compileTemplate({
      sourceRoot: MINIMAL_TEMPLATE,
      manifest,
      fixtureDir: join(MINIMAL_TEMPLATE, 'fixtures'),
      outputRoot,
    });
    expect(first.artifactId).toBe(second.artifactId);
  });

  it('rejects a manifest that fails schema validation', async () => {
    // Tamper: missing the `engine` literal.
    const manifest = loadMinimalManifest();
    const broken = { ...manifest, engine: 'unknown' as unknown as 'astro' };
    await expect(
      compileTemplate({
        sourceRoot: MINIMAL_TEMPLATE,
        manifest: broken as TemplateManifestDocument,
        fixtureDir: join(MINIMAL_TEMPLATE, 'fixtures'),
        outputRoot: join(workspace, 'artifacts'),
      }),
    ).rejects.toBeInstanceOf(CompileError);
  });
});

describe('compileTemplate: policy violation short-circuits', () => {
  it('throws PolicyError wrapped in CompileError when the template imports node:fs', async () => {
    // Build a fresh template that imports a forbidden builtin.
    const sourceRoot = join(workspace, 'evil-template');
    mkdirSync(join(sourceRoot, 'src'), { recursive: true });
    writeFileSync(
      join(sourceRoot, 'template.json'),
      canonicalJson(loadMinimalManifest()),
      'utf8',
    );
    writeFileSync(
      join(sourceRoot, 'src/Resume.astro'),
      `---
import { readFileSync } from 'node:fs';
---
<div />`,
      'utf8',
    );

    const manifest = loadMinimalManifest();
    await expect(
      compileTemplate({
        sourceRoot,
        manifest,
        fixtureDir: join(MINIMAL_TEMPLATE, 'fixtures'),
        outputRoot: join(workspace, 'artifacts'),
      }),
    ).rejects.toMatchObject({
      name: 'CompileError',
      stage: 'policy-scan',
      cause: expect.any(PolicyError),
    });
  });
});

describe('compileTemplate: fixture overflow', () => {
  it('throws RenderError when a fixture overflows the layout', async () => {
    const fixtureDir = join(workspace, 'overflow-fixtures');
    mkdirSync(fixtureDir, { recursive: true });
    const skills: Record<string, { type: 'skill'; id: string; name: string; keywords: string[] }> = {};
    for (let i = 0; i < 200; i += 1) {
      const id = `skill-${String(i).padStart(4, '0')}`;
      skills[id] = { type: 'skill', id, name: `Skill ${i}`, keywords: [] };
    }
    const cv = {
      kind: 'seevee.cv',
      schemaVersion: '1.0.0',
      id: 'cvfixtureoverflowtest0001',
      revision: 0,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      data: {
        locale: 'en-US',
        identity: {
          id: 'identityoverflowtest001',
          name: { given: 'Overflow', family: 'Test', display: 'Overflow Test' },
          contact: [],
        },
        sectionOrder: ['skills-main'],
        sections: { 'skills-main': { id: 'skills-main', type: 'skills', title: 'Skills' } },
        entities: { skills },
      },
    };
    writeFileSync(join(fixtureDir, 'overflow-cv.json'), JSON.stringify(cv), 'utf8');
    const manifest = loadMinimalManifest();
    await expect(
      compileTemplate({
        sourceRoot: MINIMAL_TEMPLATE,
        manifest,
        fixtureDir,
        outputRoot: join(workspace, 'artifacts'),
      }),
    ).rejects.toMatchObject({
      name: 'RenderError',
      stage: 'fixture-render',
    });
  });
});


describe('computeArtifactId', () => {
  it('returns a stable sha256 for the minimal template source', async () => {
    const id = await computeArtifactId(MINIMAL_TEMPLATE);
    expect(id).toMatch(/^[a-f0-9]{64}$/);
    // Recomputing must yield the same id.
    const id2 = await computeArtifactId(MINIMAL_TEMPLATE);
    expect(id).toBe(id2);
  });
});