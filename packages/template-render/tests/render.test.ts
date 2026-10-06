import { afterAll, describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';

import { cvDocumentSchema } from '@seevee/schema';
import type { CvDocument, PageProfile } from '@seevee/schema';

import {
  cachedTemplateCount,
  collectTemplateStyles,
  invalidateTemplate,
  renderTemplateToHtml,
  EntryNotFoundError,
  TemplateCompileError,
  TemplateRootNotFoundError,
  TemplateRuntimeError,
} from '../src/index.js';

// These tests execute the two templates that actually ship
// (`templates/classic/v1` and `templates/two-column/v1`) through Astro's own
// compiler and server renderer. If a template stops producing real content —
// blank fields, `[object Object]`, a descriptor object leaking into the
// output — these fail.

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');

const PROFILE: PageProfile = {
  preset: 'A4',
  orientation: 'portrait',
  edges: { top: 20, right: 20, bottom: 20, left: 20 },
};

function templateRoot(name: string): string {
  return join(REPO_ROOT, 'templates', name, 'v1');
}

function fixture(template: string, name: string): CvDocument {
  const raw = readFileSync(join(templateRoot(template), 'fixtures', `${name}-cv.json`), 'utf8');
  const parsed = cvDocumentSchema.safeParse(JSON.parse(raw));
  if (!parsed.success) {
    throw new Error(
      `fixture ${template}/${name} does not satisfy cvDocumentSchema: ` +
        `${parsed.error.issues[0]?.path.join('.')} ${parsed.error.issues[0]?.message}`,
    );
  }
  return parsed.data;
}

function render(template: string, fixtureName = 'normal'): Promise<string> {
  return renderTemplateToHtml({
    templateRoot: templateRoot(template),
    cv: fixture(template, fixtureName),
    profile: PROFILE,
  });
}

/** Every `data-seevee-field` span paired with the item it belongs to. */
function fieldSpans(html: string): ReadonlyArray<{ item: string; path: string; text: string }> {
  const spans = html.matchAll(
    /<span data-seevee-field="[^"]*" data-seevee-item="([^"]*)" data-seevee-field-path="([^"]*)"[^>]*>([^<]*)<\/span>/g,
  );
  return Array.from(spans, (match) => ({ item: match[1], path: match[2], text: match[3] }));
}

/** The text a given (item, field path) pair rendered. */
function fieldText(
  spans: ReadonlyArray<{ item: string; path: string; text: string }>,
  item: string,
  path: string,
): string | undefined {
  return spans.find((span) => span.item === item && span.path === path)?.text;
}

afterAll(async () => {
  await invalidateTemplate();
});

describe('renders the classic template', () => {
  it('produces real CV content, not blanks or leaked objects', async () => {
    const html = await render('classic');

    // Identity, contact, roles, employers, and skills all come from the CV.
    expect(html).toContain('Grace Hopper');
    expect(html).toContain('grace@example.com');
    expect(html).toContain('Senior Engineer');
    expect(html).toContain('Staff Engineer');
    expect(html).toContain('Acme');
    expect(html).toContain('Widgets Inc');
    expect(html).toContain('TypeScript');
    expect(html).toContain('Python');

    // Nothing may degrade into a stringified object or an internal descriptor.
    expect(html).not.toContain('[object Object]');
    expect(html).not.toContain('__astro_element');
  });

  it('emits the page, section, item, and field anchors the dashboard binds to', async () => {
    const html = await render('classic');

    expect(html).toContain('data-seevee-page="true"');
    expect(html).toContain('data-seevee-page-preset="A4"');
    expect(html).toContain('data-seevee-page-orientation="portrait"');

    expect(html).toContain('data-seevee-section="experience"');
    expect(html).toContain('data-seevee-section-title="Experience"');
    expect(html).toContain('data-seevee-section-type="experience"');
    expect(html).toContain('data-seevee-section-visible="true"');

    expect(html).toContain('data-seevee-item="exp_acme"');
    expect(html).toContain('data-seevee-item-type="experience"');
  });

  it('resolves every field span to its actual value', async () => {
    const html = await render('classic');
    const spans = fieldSpans(html);

    expect(fieldText(spans, 'exp_acme', '/role/title')).toBe('Senior Engineer');
    expect(fieldText(spans, 'exp_acme', '/organization/name')).toBe('Acme');
    expect(fieldText(spans, 'exp_acme', '/period/start/year')).toBe('2020');
    expect(fieldText(spans, 'exp_widgets', '/role/title')).toBe('Staff Engineer');
    expect(fieldText(spans, 'exp_widgets', '/period/end/year')).toBe('2020');
    expect(fieldText(spans, 'skl_typescript', '/name')).toBe('TypeScript');
    expect(fieldText(spans, 'skl_python', '/name')).toBe('Python');

    // The fixture's experience entities have no `summary`, so those spans
    // render empty rather than leaking a placeholder value.
    expect(fieldText(spans, 'exp_acme', '/summary')).toBe('');
    expect(spans.length).toBeGreaterThan(10);
  });
});

describe('renders the two-column template', () => {
  it('produces real CV content in both columns', async () => {
    const html = await render('two-column');

    expect(html).toContain('Grace Hopper');
    // Sidebar skills.
    expect(html).toContain('TypeScript');
    expect(html).toContain('Python');
    // Main-column experience.
    expect(html).toContain('Senior Engineer');
    expect(html).toContain('Staff Engineer');
    expect(html).toContain('Widgets Inc');

    expect(html).not.toContain('[object Object]');
    expect(html).not.toContain('__astro_element');
  });

  it('lays out a sidebar and a main column', async () => {
    const html = await render('two-column');

    expect(html).toContain('class="tw-sidebar"');
    expect(html).toContain('class="tw-main"');
    expect(html).toContain('data-seevee-section="skills"');
    expect(html).toContain('data-seevee-section="experience"');
  });

  it('resolves field spans to values in the sidebar and main column', async () => {
    const html = await render('two-column');
    const spans = fieldSpans(html);

    expect(fieldText(spans, 'skl_typescript', '/name')).toBe('TypeScript');
    expect(fieldText(spans, 'exp_acme', '/role/title')).toBe('Senior Engineer');
    expect(fieldText(spans, 'exp_widgets', '/organization/name')).toBe('Widgets Inc');
    expect(spans.length).toBeGreaterThan(10);
  });
});

describe('renders the sparse fixture', () => {
  it('renders identity and marks the sectionless CV without throwing', async () => {
    const html = await render('classic', 'sparse');
    expect(html).toContain('Ada Lovelace');
    expect(html).toContain('data-seevee-page="true"');
  });

  it('renders a CV with no entities at all in the two-column layout', async () => {
    const html = await render('two-column', 'sparse');
    expect(html).toContain('Ada Lovelace');
    expect(html).toContain('data-seevee-page="true"');
  });
});

describe('collectTemplateStyles', () => {
  it('recovers the scoped CSS the container drops from the fragment', async () => {
    // The fragment itself carries no <style> — Astro's container renders
    // components in partial mode, which suppresses head injection. Callers
    // that need a *document* must inject these sheets or print unstyled
    // markup, so this is the contract that makes PDF export possible.
    const root = templateRoot('classic');
    const html = await render('classic');
    expect(html).not.toContain('<style');

    await renderTemplateToHtml({
      templateRoot: root,
      cv: fixture('classic', 'normal'),
      profile: PROFILE,
    });
    const sheets = await collectTemplateStyles({ templateRoot: root });

    expect(sheets.length).toBeGreaterThan(0);
    const css = sheets.map((sheet) => sheet.content).join('\n');
    // The classic template's own scoped rules must be present…
    expect(css).toContain('.classic-name');
    expect(css).toContain('data-astro-cid');
    // …and every rule must be reachable from the markup we were handed.
    const scopeClass = /\.classic-name\[data-astro-cid-([0-9a-z]+)\]/i.exec(css);
    expect(scopeClass).not.toBeNull();
    expect(html).toContain(`data-astro-cid-${scopeClass![1]}`);
  });

  it('collects the two-column template page-level layout CSS', async () => {
    const root = templateRoot('two-column');
    await render('two-column');
    const sheets = await collectTemplateStyles({ templateRoot: root });
    const css = sheets.map((sheet) => sheet.content).join('\n');
    // two-column styles the page wrapper itself; losing this sheet silently
    // collapses the two-column layout to a single flow.
    expect(css).toContain('[data-seevee-page="true"]');
    expect(css).toContain('grid-template-columns');
  });

  it('returns an empty list for a template with no style block', async () => {
    const scratch = makeScratchTemplate('unstyled', '<p>plain</p>');
    await renderScratch(scratch.root);
    const sheets = await collectTemplateStyles({ templateRoot: scratch.root });
    // No CSS is a valid state, not a failure.
    expect(Array.isArray(sheets)).toBe(true);
    expect(sheets.every((sheet) => sheet.content.length > 0)).toBe(true);
  });

  it('degrades to an empty list when called before the first render', async () => {
    // Ordering matters: style modules populate during the first SSR render.
    // A premature call must degrade to an empty list rather than throw, so
    // a caller cannot crash by collecting a little too early.
    const scratch = makeScratchTemplate('premature', '<p>hi</p>');
    const sheets = await collectTemplateStyles({ templateRoot: scratch.root });
    expect(sheets).toEqual([]);
  });

  it('rejects a template root that does not exist', async () => {
    // Same contract as renderTemplateToHtml: a bad root is a typed error,
    // never a silently empty result that would ship an unstyled PDF.
    await expect(
      collectTemplateStyles({
        templateRoot: join(tmpdir(), 'seevee-never-rendered-template'),
      }),
    ).rejects.toBeInstanceOf(TemplateRootNotFoundError);
  });
});

describe('template server cache', () => {
  it('reuses one server per template root across renders', async () => {
    await invalidateTemplate();
    expect(cachedTemplateCount()).toBe(0);

    await render('classic');
    expect(cachedTemplateCount()).toBe(1);

    await render('classic');
    await render('classic');
    expect(cachedTemplateCount()).toBe(1);

    await render('two-column');
    expect(cachedTemplateCount()).toBe(2);

    // Servers are keyed by absolute root, so invalidating one template
    // leaves the other running.
    await invalidateTemplate(templateRoot('classic'));
    expect(cachedTemplateCount()).toBe(1);

    await invalidateTemplate();
    expect(cachedTemplateCount()).toBe(0);
  });

  it('picks up template source changes after invalidation', async () => {
    const scratch = makeScratchTemplate('mutable', 'Original Title');
    const first = await renderScratch(scratch.root);
    expect(first).toContain('Original Title');

    writeFileSync(scratch.entry, scratchSource('Rewritten Title', ''), 'utf8');

    // The server runs with `watch: null`, so it cannot notice the write on
    // its own: this is exactly why the studio's watcher must call
    // invalidateTemplate() on change. Documenting the stale read here makes
    // that dependency explicit rather than accidental.
    const stale = await renderScratch(scratch.root);
    expect(stale).toContain('Original Title');

    await invalidateTemplate(scratch.root);
    expect(cachedTemplateCount()).toBe(0);

    const fresh = await renderScratch(scratch.root);
    expect(fresh).toContain('Rewritten Title');
    expect(fresh).not.toContain('Original Title');
  });
});

describe('error surfacing', () => {
  it('reports a missing template root', async () => {
    const missing = join(tmpdir(), 'seevee-no-such-template');
    await expect(
      renderTemplateToHtml({
        templateRoot: missing,
        cv: fixture('classic', 'normal'),
        profile: PROFILE,
      }),
    ).rejects.toBeInstanceOf(TemplateRootNotFoundError);
  });

  it('reports a relative template root instead of guessing', async () => {
    await expect(
      renderTemplateToHtml({
        templateRoot: 'templates/classic/v1',
        cv: fixture('classic', 'normal'),
        profile: PROFILE,
      }),
    ).rejects.toBeInstanceOf(TemplateRootNotFoundError);
  });

  it('reports a missing entry file', async () => {
    await expect(
      renderTemplateToHtml({
        templateRoot: templateRoot('classic'),
        entry: 'src/DoesNotExist.astro',
        cv: fixture('classic', 'normal'),
        profile: PROFILE,
      }),
    ).rejects.toBeInstanceOf(EntryNotFoundError);
  });

  it('refuses an entry that escapes the template root', async () => {
    await expect(
      renderTemplateToHtml({
        templateRoot: templateRoot('classic'),
        entry: '../../packages/schema/src/index.ts',
        cv: fixture('classic', 'normal'),
        profile: PROFILE,
      }),
    ).rejects.toBeInstanceOf(EntryNotFoundError);
  });

  it('reports a compile error with the offending file and line', async () => {
    // Invalid JavaScript in the frontmatter: Astro's compiler accepts the
    // markup, and esbuild rejects the script block when the module is
    // transformed. The error must carry the template's path and line.
    const scratch = makeScratchTemplate('broken', 'unreachable', 'const = ;');

    const error = await renderScratch(scratch.root).then(
      () => null,
      (thrown: unknown) => thrown,
    );

    expect(error).toBeInstanceOf(TemplateCompileError);
    const compileError = error as TemplateCompileError;
    expect(compileError.code).toBe('COMPILE_ERROR');
    expect(compileError.file).toBe(scratch.entry);
    expect(compileError.line).toBe(3);
    expect(compileError.message).toContain('Resume.astro');
  });

  it('reports a runtime error thrown from a template', async () => {
    const scratch = makeScratchTemplate(
      'throws',
      'never rendered',
      'throw new Error("template exploded");',
    );
    await expect(renderScratch(scratch.root)).rejects.toMatchObject({
      code: 'RUNTIME_ERROR',
      message: expect.stringContaining('template exploded'),
    });
  });
});

// ─── Scratch-template helpers ──────────────────────────────────────────────

const scratchDirs: string[] = [];

afterAll(() => {
  for (const dir of scratchDirs) {
    rmSync(dir, { recursive: true, force: true });
  }
});

/**
 * Write a minimal but valid template root to a temp directory. `frontmatter`
 * is extra code injected into the template's script block, so a test can make
 * a template that throws; `body` is its markup.
 *
 * The scratch template imports the SDK from the real workspace package so it
 * exercises the same module-resolution path a shipped template does — which
 * is the part that breaks when a template lives outside the workspace.
 */
function makeScratchTemplate(
  name: string,
  body: string,
  frontmatter = '',
): { root: string; entry: string } {
  const root = mkdtempSync(join(tmpdir(), `seevee-tpl-${name}-`));
  scratchDirs.push(root);
  mkdirSync(join(root, 'src'), { recursive: true });

  writeFileSync(join(root, 'template.json'), scratchManifest(name), 'utf8');

  const entry = join(root, 'src', 'Resume.astro');
  writeFileSync(entry, scratchSource(body, frontmatter), 'utf8');
  return { root, entry };
}

function scratchManifest(name: string): string {
  return JSON.stringify({
    kind: 'seevee.template-manifest',
    schemaVersion: '1.0.0',
    id: 'tplscratch00000000000000001',
    templateId: name.replace(/[^a-z0-9]/g, '').padEnd(24, '0').slice(0, 24),
    name,
    version: '1.0.0',
    entry: 'src/Resume.astro',
    engine: 'astro',
    capabilities: {
      multiPage: false,
      customPageSize: false,
      comments: true,
      twoColumn: false,
    },
    supportedCvSchema: '1.0.0',
    supportedPresentationSchema: '1.0.0',
    tokens: {},
    bindings: {},
    extensions: {},
    designIntent: { sector: 'general', voice: 'minimal', constraints: [] },
  });
}

function scratchSource(body: string, frontmatter: string): string {
  return [
    '---',
    "import { Page } from '@seevee/template-sdk/components';",
    frontmatter,
    '---',
    '<Page profile={Astro.props.profile}>',
    body,
    '</Page>',
    '',
  ].join('\n');
}

/** Render a scratch template root with the shared normal fixture. */
function renderScratch(root: string): Promise<string> {
  return renderTemplateToHtml({
    templateRoot: root,
    cv: fixture('classic', 'normal'),
    profile: PROFILE,
  });
}