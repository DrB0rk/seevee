import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { cvDocumentSchema } from '@seevee/schema';
import type { CvDocument, PageProfile } from '@seevee/schema';

import {
  collectTemplateStyles,
  invalidateTemplate,
  renderTemplateToHtml,
  TemplateCompileError,
} from '../src/index.js';

// Scoped CSS is not part of the rendered fragment: Astro's container renders
// in "partial" mode and suppresses head injection, so `renderTemplateToHtml`
// returns markup that carries `data-astro-cid-*` attributes but no <style>.
// Every consumer that needs a real document (PDF export, dashboard preview)
// has to gather the CSS itself.

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');

const PROFILE: PageProfile = { preset: 'A4', orientation: 'portrait' };

function templateRoot(name: string): string {
  return join(REPO_ROOT, 'templates', name, 'v1');
}

function fixture(template: string): CvDocument {
  const path = join(templateRoot(template), 'fixtures', 'normal-cv.json');
  return cvDocumentSchema.parse(JSON.parse(readFileSync(path, 'utf8')));
}

const scratchRoots: string[] = [];

afterEach(async () => {
  await invalidateTemplate();
  while (scratchRoots.length > 0) {
    const dir = scratchRoots.pop();
    if (dir !== undefined) rmSync(dir, { recursive: true, force: true });
  }
});

/** Scope ids Astro put on the markup (e.g. `data-astro-cid-4fkc5jfw`). */
function markupScopes(html: string): ReadonlySet<string> {
  const ids = html.match(/data-astro-cid-([a-z0-9]+)/g) ?? [];
  return new Set(ids.map((id) => id.replace('data-astro-cid-', '')));
}

/** Scope ids the stylesheets actually target. */
function cssScopes(sheets: ReadonlyArray<{ content: string }>): ReadonlySet<string> {
  const found = sheets.flatMap(
    (sheet) => sheet.content.match(/\[data-astro-cid-([a-z0-9]+)\]/g) ?? [],
  );
  return new Set(found.map((id) => id.replace(/\[data-astro-cid-|\]/g, '')));
}

describe('collectTemplateStyles on the shipped templates', () => {
  it('returns real scoped CSS for classic', async () => {
    const sheets = await collectTemplateStyles({ templateRoot: templateRoot('classic') });

    expect(sheets.length).toBeGreaterThan(0);
    const total = sheets.reduce((sum, sheet) => sum + sheet.content.length, 0);
    expect(total).toBeGreaterThan(500);
    // Genuinely compiled CSS, not the raw source.
    expect(sheets.some((sheet) => sheet.content.includes('data-astro-cid-'))).toBe(true);
  });

  it('returns real scoped CSS for two-column', async () => {
    const sheets = await collectTemplateStyles({ templateRoot: templateRoot('two-column') });

    expect(sheets.length).toBeGreaterThan(0);
    expect(sheets.some((sheet) => sheet.content.includes('[data-seevee-page="true"]'))).toBe(true);
  });

  it('inlines into a document whose rules actually target the rendered markup', async () => {
    // End-to-end shape of what PDF export / preview will do: render, collect
    // the CSS, inline it into a <style> block, and check that a real rule
    // from the template's own stylesheet is present and scoped to the
    // markup we rendered. Asserting only "CSS was returned" would miss the
    // unstyled-document failure entirely.
    const root = templateRoot('two-column');
    const html = await renderTemplateToHtml({
      templateRoot: root,
      cv: fixture('two-column'),
      profile: PROFILE,
    });
    const sheets = await collectTemplateStyles({ templateRoot: root });
    const document = `<!doctype html><html><head><style>${sheets
      .map((sheet) => sheet.content)
      .join('\n')}</style></head><body>${html}</body></html>`;

    // The two-column layout is driven entirely by this grid rule; if it is
    // missing the page renders as one unformatted column.
    expect(document).toContain('[data-seevee-page="true"]{display:grid');
    expect(document).toContain('grid-template-columns');
    // And the rule must be scoped to the id the rendered markup carries.
    const scope = [...markupScopes(html)][0];
    expect(scope).toBeDefined();
    expect(document).toContain(`[data-astro-cid-${scope}]`);
  });

  it('produces CSS that actually matches the scope ids in the markup', async () => {
    const root = templateRoot('classic');
    const html = await renderTemplateToHtml({
      templateRoot: root,
      cv: fixture('classic'),
      profile: PROFILE,
    });
    const sheets = await collectTemplateStyles({ templateRoot: root });

    const inMarkup = markupScopes(html);
    const inCss = cssScopes(sheets);

    expect(inMarkup.size).toBeGreaterThan(0);
    // Every scope id the markup relies on must be targeted by the CSS,
    // otherwise injecting these sheets would leave elements unstyled.
    for (const scope of inMarkup) {
      expect(inCss.has(scope)).toBe(true);
    }
  });
});

describe('collectTemplateStyles does not depend on call order', () => {
  // Regression pin. Astro only populates style modules in the Vite module
  // graph during the first SSR evaluation of the entry, so a previous version
  // returned `[]` when called before any render. That empty result was
  // indistinguishable from a template that genuinely has no CSS, and silently
  // produced an unstyled document.
  it('returns the real sheets when called FIRST on a fresh template root', async () => {
    await invalidateTemplate();

    const sheets = await collectTemplateStyles({ templateRoot: templateRoot('classic') });

    expect(sheets.length).toBeGreaterThan(0);
    expect(sheets.reduce((sum, sheet) => sum + sheet.content.length, 0)).toBeGreaterThan(500);
  });

  it('returns the same sheets whether or not a render happened first', async () => {
    const root = templateRoot('two-column');

    await invalidateTemplate();
    const withoutRender = await collectTemplateStyles({ templateRoot: root });

    await invalidateTemplate();
    await renderTemplateToHtml({
      templateRoot: root,
      cv: fixture('two-column'),
      profile: PROFILE,
    });
    const afterRender = await collectTemplateStyles({ templateRoot: root });

    const css = (sheets: ReadonlyArray<{ content: string }>) =>
      sheets.map((sheet) => sheet.content).join('\n');
    expect(css(withoutRender)).toBe(css(afterRender));
  });

  it('still returns an empty list for a template that genuinely has no CSS', async () => {
    // An empty result must now mean "no CSS", not "you forgot to render first".
    const scratch = makeScratchTemplate('nostyle', '<p>plain</p>', '');

    const sheets = await collectTemplateStyles({ templateRoot: scratch });

    expect(sheets).toEqual([]);
  });
});

describe('collectTemplateStyles failure surfacing', () => {
  it('reports a compile error rather than returning an empty list', async () => {
    const scratch = makeScratchTemplate('badstyle', 'never', 'const = ;');

    await expect(
      collectTemplateStyles({ templateRoot: scratch }),
    ).rejects.toBeInstanceOf(TemplateCompileError);
  });

  it('reports a missing entry file', async () => {
    await expect(
      collectTemplateStyles({
        templateRoot: templateRoot('classic'),
        entry: 'src/Nope.astro',
      }),
    ).rejects.toThrow(/not found/i);
  });
});

/**
 * Write a minimal template root to a temp directory. `frontmatter` is extra
 * script-block code, so a test can make a template that throws or that has
 * no CSS.
 */
function makeScratchTemplate(
  name: string,
  body: string,
  frontmatter: string,
): string {
  const root = mkdtempSync(join(tmpdir(), `seevee-style-${name}-`));
  scratchRoots.push(root);
  mkdirSync(join(root, 'src'), { recursive: true });

  writeFileSync(
    join(root, 'template.json'),
    JSON.stringify({
      kind: 'seevee.template-manifest',
      schemaVersion: '1.0.0',
      id: 'tplstylecheck000000000000001',
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
    }),
    'utf8',
  );

  writeFileSync(
    join(root, 'src', 'Resume.astro'),
    [
      '---',
      "import { Page } from '@seevee/template-sdk/components';",
      frontmatter,
      '---',
      '<Page profile={Astro.props.profile}>',
      body,
      '</Page>',
      '',
    ].join('\n'),
    'utf8',
  );

  return root;
}