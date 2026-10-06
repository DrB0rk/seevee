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

import { templateManifestDocumentSchema, cvDocumentSchema } from '@seevee/schema';
import type { TemplateManifestDocument } from '@seevee/schema';
import { collectTemplateStyles, renderTemplateToHtml } from '@seevee/template-render';

import {
  compileTemplate,
  CompileError,
  ManifestError,
  PolicyError,
  RenderError,
  canonicalJson,
  computeArtifactId,
  renderFixtures,
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

  // The overflow fixture above only proves the stage THROWS. These two tests
  // pin down WHY, so a regression back to per-entity height constants
  // (entities * 12mm) cannot pass unnoticed: the old arithmetic gave a
  // 2-entity fixture exactly 24mm, and both of these assertions reject it.
  it('measures a real laid-out height rather than counting entities', async () => {
    const fixtureDir = join(workspace, 'two-entity-fixtures');
    mkdirSync(fixtureDir, { recursive: true });
    const skills: Record<string, { type: 'skill'; id: string; name: string; keywords: string[] }> = {};
    for (let i = 0; i < 2; i += 1) {
      const id = `skill-${String(i).padStart(4, '0')}`;
      skills[id] = { type: 'skill', id, name: `Skill ${i}`, keywords: [] };
    }
    writeFileSync(
      join(fixtureDir, 'two-cv.json'),
      JSON.stringify({
        kind: 'seevee.cv',
        schemaVersion: '1.0.0',
        id: 'cvfixturetwosmall000001',
        revision: 0,
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
        data: {
          locale: 'en-US',
          identity: {
            id: 'identitytwosmall00001',
            name: { given: 'Two', family: 'Entity', display: 'Two Entity' },
            contact: [],
          },
          sectionOrder: ['skills-main'],
          sections: { 'skills-main': { id: 'skills-main', type: 'skills', title: 'Skills' } },
          entities: { skills },
        },
      }),
      'utf8',
    );

    const outcome = await renderFixtures({
      fixtureDir,
      sourceRoot: MINIMAL_TEMPLATE,
      manifest: loadMinimalManifest(),
    });

    expect(outcome.diagnostic.level).toBe('pass');
    expect(outcome.perFixture).toHaveLength(1);

    const [measured] = outcome.perFixture;
    // A real browser laid this out, so the height is whatever the template
    // actually produced — not the old 2 * 12mm = 24mm constant.
    expect(measured.contentHeightMm).toBeGreaterThan(0);
    expect(measured.contentHeightMm).not.toBe(24);
    // It genuinely fits, so no overflow is claimed.
    expect(measured.overflowMm).toBe(0);
    expect(outcome.hasOverflow).toBe(false);
  });

  it('reports the measured overflow amount on an overflowing fixture', async () => {
    const fixtureDir = join(workspace, 'big-entity-fixtures');
    mkdirSync(fixtureDir, { recursive: true });
    const skills: Record<string, { type: 'skill'; id: string; name: string; keywords: string[] }> = {};
    for (let i = 0; i < 200; i += 1) {
      const id = `skill-${String(i).padStart(4, '0')}`;
      skills[id] = { type: 'skill', id, name: `Skill ${i}`, keywords: [] };
    }
    writeFileSync(
      join(fixtureDir, 'big-cv.json'),
      JSON.stringify({
        kind: 'seevee.cv',
        schemaVersion: '1.0.0',
        id: 'cvfixturebigentity00001',
        revision: 0,
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
        data: {
          locale: 'en-US',
          identity: {
            id: 'identitybigentity00001',
            name: { given: 'Big', family: 'Entity', display: 'Big Entity' },
            contact: [],
          },
          sectionOrder: ['skills-main'],
          sections: { 'skills-main': { id: 'skills-main', type: 'skills', title: 'Skills' } },
          entities: { skills },
        },
      }),
      'utf8',
    );

    const outcome = await renderFixtures({
      fixtureDir,
      sourceRoot: MINIMAL_TEMPLATE,
      manifest: loadMinimalManifest(),
    });

    const [measured] = outcome.perFixture;
    // The measured height is what overflows the box. It is not the stub's
    // 200 * 12mm = 2400mm, which is why this asserts the relationship
    // instead of a constant: the point is that it is a browser's answer.
    expect(measured.contentHeightMm).toBeGreaterThan(measured.contentBoxHeightMm);
    expect(measured.contentHeightMm).not.toBe(2400);
    expect(measured.overflowMm).toBeCloseTo(
      measured.contentHeightMm - measured.contentBoxHeightMm,
      3,
    );
    expect(outcome.hasOverflow).toBe(true);
    expect(outcome.diagnostics.totalOverflow).toBeCloseTo(measured.overflowMm, 3);
  });

  it('renders the template and inlines its stylesheet, not an unstyled fragment', async () => {
    // Regression guard for the silent failure mode: collect styles BEFORE the
    // first render and Astro has not populated the style modules yet, so the
    // document comes back unstyled with no error raised anywhere.
    //
    // A real shipped template — the minimal fixture has no CSS of its own,
    // so only this one can prove the stylesheet is actually collected.
    const root = resolve(HERE, '../../../templates/classic/v1');
    const manifest = templateManifestDocumentSchema.parse(
      JSON.parse(readFileSync(join(root, 'template.json'), 'utf8')),
    );
    const profile = {
      preset: 'A4' as const,
      orientation: 'portrait' as const,
      edges: { top: 20, right: 20, bottom: 20, left: 20 },
    };
    const cv = cvDocumentSchema.parse(
      JSON.parse(readFileSync(join(root, 'fixtures/normal-cv.json'), 'utf8')),
    );

    const html = await renderTemplateToHtml({
      templateRoot: root,
      entry: manifest.entry,
      cv,
      profile,
    });
    const sheets = await collectTemplateStyles({
      templateRoot: root,
      entry: manifest.entry,
    });

    // The fragment is markup only — Astro's container renders in partial mode
    // and suppresses head injection.
    expect(html).toContain('data-seevee-page');
    expect(html).not.toContain('<style');

    // The compiled stylesheet is what makes the measured layout real.
    expect(sheets.length).toBeGreaterThan(0);
    const css = sheets.map((sheet) => sheet.content).join('\n');
    expect(css.length).toBeGreaterThan(0);
    // Astro scopes CSS to the component it came from; that scope attribute
    // is what ties the stylesheet to the markup above, and it must match the
    // one the template actually rendered.
    const scope = css.match(/\[data-astro-cid-([a-z0-9]+)\]/)?.[1];
    expect(scope).toBeDefined();
    expect(html).toContain(`data-astro-cid-${scope}`);
    // A marker from the template's own stylesheet, proving these are the
    // real compiled rules rather than an empty or placeholder sheet.
    expect(css).toContain('.classic-name');
  });

  it('records the stage as skipped (never as a pass) when no browser is available', async () => {
    const outcome = await renderFixtures({
      fixtureDir: join(MINIMAL_TEMPLATE, 'fixtures'),
      sourceRoot: MINIMAL_TEMPLATE,
      manifest: loadMinimalManifest(),
      playwright: {
        chromium: {
          launch: async () => {
            throw new Error("Executable doesn't exist at /nonexistent/chrome");
          },
        },
      },
    });

    // A host with no Chromium must not silently produce invented numbers.
    expect(outcome.diagnostic.level).toBe('skipped');
    expect(outcome.perFixture).toHaveLength(0);
    expect(outcome.pages).toBe(0);
    expect(outcome.diagnostic.details?.mode).toBe('skipped');
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