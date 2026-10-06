/**
 * `/api/render/preview` renders the workspace's real template.
 *
 * The assertions here are deliberately about *content*, not status codes: a
 * 200 carrying an empty page is exactly the stub behaviour this route used to
 * have, so every check below looks for text that can only be present if the
 * template's own Astro source actually executed against the fixture CV.
 *
 * The fixture workspace is copied to a temp dir per suite because rendering
 * boots a real Astro/Vite server over the template directory, and the Vite
 * cache is keyed by directory — sharing one across tests would serve a stale
 * compile.
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
const CV_EMAIL = 'ada@example.com';
const EXPERIENCE_ROLE = 'Senior Engineer';
const EXPERIENCE_EMPLOYER = 'Acme';

interface PreviewPage {
  pageNumber: number;
  width: number;
  height: number;
  overflow: boolean;
  overflowAmount: number;
  html: string;
}

interface PreviewBody {
  ok: boolean;
  reason?: string;
  templateCode?: string;
  cvId?: string;
  presentationId?: string;
  profile?: string;
  template?: { templateId: string; versionId: string; entry: string };
  result?: {
    pages: PreviewPage[];
    html: string;
    diagnostics: {
      overflow: boolean;
      clippedNodes: string[];
      blankPages: number[];
      warnings: string[];
    };
  };
}

async function postPreview(body: unknown): Promise<{ status: number; body: PreviewBody }> {
  // Deferred import: a static one would bind workspace discovery at module
  // load, before `beforeAll` points SEEEVEE_WORKSPACE_ROOT at the temp copy.
  const mod = await import('../src/pages/api/render/preview.js');
  const request = new Request('http://127.0.0.1:43129/api/render/preview', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const res = await mod.POST({ request } as Parameters<typeof mod.POST>[0]);
  return { status: res.status, body: (await res.json()) as PreviewBody };
}

beforeAll(async () => {
  previousCwd = process.cwd();
  testRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'seevee-studio-render-'));
  await fs.cp(fixtureRoot, testRoot, { recursive: true });
  process.env['SEEVEE_WORKSPACE_ROOT'] = testRoot;
  process.chdir(testRoot);
});

afterAll(async () => {
  delete process.env['SEEVEE_WORKSPACE_ROOT'];
  process.chdir(previousCwd);
  await fs.rm(testRoot, { recursive: true, force: true });
});

describe('POST /api/render/preview — real template render', () => {
  it('renders the presentation template and returns the fixture CV content', async () => {
    const { status, body } = await postPreview({ cvId: 'cv_test' });

    expect(status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.cvId).toBe('cv_test');
    expect(body.presentationId).toBe('pres_test');

    const fragment = body.result?.pages[0]?.html ?? '';
    // These strings exist nowhere in the studio or the fixture template source;
    // they only appear if the template bound the CV's fields and rendered them.
    expect(fragment).toContain(CV_NAME);
    expect(fragment).toContain(CV_EMAIL);
    expect(fragment).toContain(EXPERIENCE_ROLE);
    expect(fragment).toContain(EXPERIENCE_EMPLOYER);
  }, 60_000);

  it('wraps the fragment in a full document carrying page geometry', async () => {
    const { body } = await postPreview({ cvId: 'cv_test' });
    const html = body.result?.html ?? '';

    expect(html).toContain('<!doctype html>');
    expect(html).toContain('<html lang="en">');
    expect(html).toContain('</html>');
    // A4 portrait geometry, resolved from the presentation's page profile.
    expect(html).toContain('@page');
    expect(html).toContain('210mm');
    expect(html).toContain('297mm');
    // The template's own content must survive the wrap.
    expect(html).toContain(CV_NAME);
  }, 60_000);

  it('reports the template version and entry it executed', async () => {
    const { body } = await postPreview({ cvId: 'cv_test' });
    expect(body.template).toEqual({
      templateId: 'tpl_minimal',
      versionId: 'tpl_minimal_v1',
      entry: 'source.astro',
    });
  }, 60_000);

  it('carries the template SDK anchors the dashboard anchors comments on', async () => {
    const { body } = await postPreview({ cvId: 'cv_test' });
    const fragment = body.result?.pages[0]?.html ?? '';

    expect(fragment).toContain('data-seevee-page');
    expect(fragment).toContain('data-seevee-section');
  }, 60_000);

  it('preserves the page array shape the dashboard consumes', async () => {
    const { body } = await postPreview({ cvId: 'cv_test' });
    const pages = body.result?.pages ?? [];

    expect(pages.length).toBeGreaterThan(0);
    for (const page of pages) {
      expect(typeof page.pageNumber).toBe('number');
      expect(page.width).toBe(210);
      expect(page.height).toBe(297);
      expect(typeof page.overflow).toBe('boolean');
      expect(typeof page.overflowAmount).toBe('number');
    }
    // Diagnostics must be structured, never a stub string.
    const diagnostics = body.result?.diagnostics;
    expect(typeof diagnostics?.overflow).toBe('boolean');
    expect(Array.isArray(diagnostics?.clippedNodes)).toBe(true);
    expect(Array.isArray(diagnostics?.blankPages)).toBe(true);
    expect(Array.isArray(diagnostics?.warnings)).toBe(true);
  }, 60_000);

  it('renders no stub warning', async () => {
    const { body } = await postPreview({ cvId: 'cv_test' });
    expect(JSON.stringify(body)).not.toContain('renderer stub');
  }, 60_000);

  it('inlines the template scoped CSS the fragment needs to be styled', async () => {
    const { body } = await postPreview({ cvId: 'cv_test' });
    const html = body.result?.html ?? '';
    const fragment = body.result?.pages[0]?.html ?? '';

    // Astro renders the component in partial mode, which drops the template's
    // own <style> blocks. Without them the preview is unstyled content that
    // merely looks like a document, so their presence is asserted directly.
    expect(html).toContain('<style data-seevee-template-style=');
    expect(html).toMatch(/\.classic-name\[data-astro-cid-[a-z0-9]+\]/u);

    // The scoping selectors only match if the fragment kept the attributes
    // Astro attaches them to.
    expect(fragment).toMatch(/data-astro-cid-[a-z0-9]+/u);
  }, 60_000);

  it('applies a profile override to the page geometry', async () => {
    const { status, body } = await postPreview({ cvId: 'cv_test', profile: 'Letter' });

    expect(status).toBe(200);
    expect(body.profile).toBe('Letter');
    expect(body.result?.html).toContain('215.9mm');
    expect(body.result?.pages[0]?.width).toBe(215.9);
    // Content must still render — the override is geometry, not a bail-out.
    expect(body.result?.pages[0]?.html).toContain(CV_NAME);
  }, 60_000);

  it('rejects a request naming a presentation that targets another CV', async () => {
    const { status, body } = await postPreview({ cvId: 'cv_other', presentationId: 'pres_test' });
    expect(status).toBe(404);
    expect(body.ok).toBe(false);
  });

  it('reports a missing presentation rather than rendering nothing', async () => {
    const { status, body } = await postPreview({ cvId: 'cv_test', presentationId: 'pres_missing' });
    expect(status).toBe(404);
    expect(body.ok).toBe(false);
    expect(body.reason).toContain('pres_missing');
  });
});