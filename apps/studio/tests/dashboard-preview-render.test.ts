/**
 * The dashboard's preview mount consumes `/api/render/preview`.
 *
 * `render-preview.test.ts` proves the endpoint returns a real render. This
 * suite covers the contract on the *client* side of that hand-off, which is
 * where the silent failure mode lives: `pages[].html` arrives with
 * `data-astro-cid-*` attributes but no `<style>` blocks (Astro's partial
 * render drops them), so mounting the fragment without also lifting the
 * stylesheet out of `result.html` produces real content rendering as
 * unstyled default text. A status-code assertion would pass in that state,
 * so every check below is about real content and real CSS.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const fixtureRoot = fileURLToPath(new URL('./fixtures/workspace', import.meta.url));
let testRoot = '';
let previousCwd = '';

/** Text that appears only when the template's own source has rendered. */
const CV_NAME = 'Ada Lovelace';
const EXPERIENCE_ROLE = 'Senior Engineer';

/**
 * The extraction the dashboard performs on `result.html`.
 *
 * Duplicated verbatim on purpose: this file runs in `environment: 'node'`
 * with no DOM, and importing the `.astro` script block would pull in the
 * whole dashboard. Keeping the two copies byte-identical is what makes this
 * an assertion about the dashboard's real behaviour; the regex is anchored on
 * the `data-seevee-template-style` attribute the renderer emits.
 */
function extractTemplateStyles(document: string): string {
  const styles: string[] = [];
  const pattern = /<style data-seevee-template-style="[^"]*">([\s\S]*?)<\/style>/g;
  for (const match of document.matchAll(pattern)) styles.push(match[1]!.trim());
  return styles.join('\n');
}

interface PreviewPage {
  pageNumber: number;
  html: string;
}

interface PreviewBody {
  ok: boolean;
  reason?: string;
  result?: { pages: PreviewPage[]; html: string };
}

async function postPreview(body: unknown): Promise<PreviewBody> {
  const mod = await import('../src/pages/api/render/preview.js');
  const request = new Request('http://127.0.0.1/43130/api/render/preview', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const res = await mod.POST({ request } as Parameters<typeof mod.POST>[0]);
  return (await res.json()) as PreviewBody;
}

beforeAll(async () => {
  previousCwd = process.cwd();
  testRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'seevee-studio-mount-'));
  await fs.cp(fixtureRoot, testRoot, { recursive: true });
  process.env['SEEVEE_WORKSPACE_ROOT'] = testRoot;
  process.chdir(testRoot);
});

afterAll(async () => {
  delete process.env['SEEVEE_WORKSPACE_ROOT'];
  process.chdir(previousCwd);
  await fs.rm(testRoot, { recursive: true, force: true });
});

describe('preview mount contract', () => {
  it('supplies the fragment the dashboard injects as markup', async () => {
    const body = await postPreview({ cvId: 'cv_test' });
    const fragment = body.result?.pages[0]?.html ?? '';

    // Injected with innerHTML, so the anchors the dashboard's comment
    // placement and rerender slots depend on must survive into the DOM.
    expect(fragment).toContain(CV_NAME);
    expect(fragment).toContain(EXPERIENCE_ROLE);
    expect(fragment).toContain('data-seevee-section');
    expect(fragment).toMatch(/data-astro-cid-[a-z0-9]+/u);
  }, 60_000);

  it('supplies scoped CSS the extracted styles actually match', async () => {
    const body = await postPreview({ cvId: 'cv_test' });
    const fragment = body.result?.pages[0]?.html ?? '';
    const styles = extractTemplateStyles(body.result?.html ?? '');

    // Without this the page renders as unstyled default text while still
    // looking like a successful load — the failure mode this suite exists to
    // prevent.
    expect(styles.length).toBeGreaterThan(0);

    // The binding direction that makes a page styled: every scoping
    // attribute present in the fragment must be targeted by the extracted
    // CSS. (The reverse is not an invariant — a template may ship rules for
    // branches this CV does not exercise, such as a project section when the
    // CV has no projects.)
    const fragmentScopes = new Set([...fragment.matchAll(/data-astro-cid-([a-z0-9]+)/giu)].map((m) => m[1]!));
    expect(fragmentScopes.size).toBeGreaterThan(0);
    const styledScopes = new Set([...styles.matchAll(/data-astro-cid-([a-z0-9]+)/giu)].map((m) => m[1]!));
    for (const scope of fragmentScopes) {
      expect(styledScopes.has(scope)).toBe(true);
    }
  }, 60_000);

  it('keeps the extracted CSS free of the page geometry the paper owns', async () => {
    const body = await postPreview({ cvId: 'cv_test' });
    const styles = extractTemplateStyles(body.result?.html ?? '');

    // `@page` belongs to print, and the paper already carries geometry via
    // --page-* custom properties; a second rule would fight it.
    expect(styles).not.toContain('@page');
  }, 60_000);

  it('reports a broken template as a structured failure rather than blank markup', async () => {
    const body = await postPreview({ cvId: 'does-not-exist' });

    // The dashboard renders this reason on the page; an empty 200 would be
    // indistinguishable from a legitimately empty CV.
    expect(body.ok).toBe(false);
    expect(typeof body.reason).toBe('string');
    expect((body.reason ?? '').length).toBeGreaterThan(0);
    expect(body.result).toBeUndefined();
  }, 60_000);
});