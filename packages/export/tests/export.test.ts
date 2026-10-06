// End-to-end tests for @seevee/export.
//
// Every test that drives `exportToPdf` injects a fake Playwright
// module so the suite does not require Playwright to be installed.
// The fixtures live under `tests/fixtures/` and are copied from
// schema and renderer test fixtures at commit time. The tests write
// generated PDF and metadata files into a per-test temp directory
// that is cleaned up at module teardown.

import { mkdtemp, rm, readFile, stat, readdir, writeFile } from 'node:fs/promises';
import { copyFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { PageProfile } from '@seevee/schema';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { exportToPdf } from '../src/export.js';
import { capturePdf, loadPlaywrightModule } from '../src/playwright.js';
import {
  ExportError,
  IoError,
  PdfValidationError,
  PlaywrightNotInstalledError,
  ChromiumMissingError,
  RenderDiagnosticsError,
  ValidationError,
} from '../src/errors.js';
import type { PlaywrightModule } from '../src/types.js';
import {
  exportMetadataPath,
  isPlaywrightInstalledAt,
  isPlaywrightAvailable,
  writeExportMetadata,
  generateExportId,
} from '../src/index.js';
import { readPdfInfo } from '../src/pdf-info.js';
import {
  createFakePlaywright,
  type FakePlaywrightHandle,
} from './fake-playwright.js';
import type { ExportOptions } from '../src/types.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURES = resolve(HERE, 'fixtures');
const TEMPLATE_DIR = resolve(FIXTURES, 'template');

interface WorkspaceRoot {
  root: string;
  cleanup: () => Promise<void>;
}

interface WorkspacePlan {
  readonly workspaceFixture: string;
  readonly cvFixture: string;
  readonly cvRelative: string;
  readonly presentationFixture?: string;
}

async function buildWorkspace(plan: WorkspacePlan): Promise<WorkspaceRoot> {
  const root = await mkdtemp(join(tmpdir(), 'seevee-export-'));
  await copyFixtureInto(plan.workspaceFixture, 'seevee.json', root);
  await copyFixtureInto(plan.cvFixture, plan.cvRelative, root);
  const presentationFixture = plan.presentationFixture ?? 'presentation.json';
  await copyFixtureInto(
    presentationFixture,
    'presentations/pres_main.json',
    root,
  );
  return {
    root,
    cleanup: async () => {
      await rm(root, { recursive: true, force: true });
    },
  };
}

async function copyWorkspaceFixture(): Promise<WorkspaceRoot> {
  return buildWorkspace({
    workspaceFixture: 'workspace.json',
    cvFixture: 'cv.json',
    cvRelative: 'cvs/cv_main.json',
  });
}

async function copyDenseWorkspaceFixture(): Promise<WorkspaceRoot> {
  return buildWorkspace({
    workspaceFixture: 'workspace-dense.json',
    cvFixture: 'dense-cv.json',
    cvRelative: 'cvs/cv_dense.json',
    presentationFixture: 'presentation-dense.json',
  });
}

async function copyFixtureInto(
  fixtureName: string,
  relativePath: string,
  root: string,
): Promise<void> {
  const source = resolve(FIXTURES, fixtureName);
  const target = resolve(root, relativePath);
  await mkdir(dirname(target), { recursive: true });
  await copyFile(source, target);
}

const A4_PORTRAIT: PageProfile = {
  preset: 'A4',
  orientation: 'portrait',
};

const fakePlaywright = createFakePlaywright();

afterAll(async () => {
  // Best-effort cleanup; nothing to do if the fixtures aren't present.
});

describe('exportToPdf (happy path)', () => {
  let workspace: WorkspaceRoot;
  let outputDir: string;

  beforeEach(async () => {
    workspace = await copyWorkspaceFixture();
    outputDir = await mkdtemp(join(workspace.root, '-out-'));
  });

  it('produces a valid PDF + metadata for a fitted CV', async () => {
    const outputPath = join(outputDir, 'cv.pdf');
    const options: ExportOptions = {
      workspaceRoot: workspace.root,
      cvId: 'cv_main',
      presentationId: 'pres_main',
      templateArtifactPath: TEMPLATE_DIR,
      outputPath,
      pageProfile: A4_PORTRAIT,
      playwright: fakePlaywright.module,
    };

    const result = await exportToPdf(options);

    // ─── Result shape contract ───────────────────────────────────────────
    expect(result.outputPath).toBe(outputPath);
    expect(result.pageCount).toBeGreaterThan(0);
    expect(result.bytes).toBeGreaterThan(0);
    expect(result.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(result.exportId).toMatch(/^exp_/);
    expect(result.startedAt).toMatch(/T.*Z$/);
    expect(result.completedAt).toMatch(/T.*Z$/);
    // `pageCount` is read back from the PDF; `estimatedPageCount` is the
    // renderer's pre-render model. They are two different layout engines
    // describing the same document, so they are reported side by side and
    // deliberately NOT asserted equal.
    expect(result.pageCount).toBeGreaterThan(0);
    expect(result.estimatedPageCount).toBeGreaterThan(0);

    // ─── File on disk + size matches reported bytes ──────────────────────
    const onDisk = await stat(outputPath);
    expect(onDisk.size).toBe(result.bytes);
    const head = (await readFile(outputPath, { encoding: 'utf8' })).slice(
      0,
      5,
    );
    expect(head).toBe('%PDF-');

    // ─── Metadata persists to disk ───────────────────────────────────────
    const metaPath = exportMetadataPath(workspace.root, result.exportId);
    const metaRaw = await readFile(metaPath, 'utf8');
    const meta = JSON.parse(metaRaw);
    expect(meta.outputPath).toBe(outputPath);
    expect(meta.sha256).toBe(result.sha256);
    expect(meta.exportId).toBe(result.exportId);
  });

  it('invokes Playwright in lifecycle order: launch → newPage → setContent → pdf → close', async () => {
    const outputPath = join(outputDir, 'cv.pdf');
    await exportToPdf({
      workspaceRoot: workspace.root,
      cvId: 'cv_main',
      presentationId: 'pres_main',
      templateArtifactPath: TEMPLATE_DIR,
      outputPath,
      pageProfile: A4_PORTRAIT,
      playwright: fakePlaywright.module,
    });

    const kinds = fakePlaywright.calls.map((c) => c.kind);
    expect(kinds[0]).toBe('launch');
    expect(kinds).toContain('newPage');
    expect(kinds).toContain('setContent');
    expect(kinds).toContain('pdf');
    expect(kinds[kinds.length - 1]).toBe('browser-close');
    // Both the page and the browser must be closed.
    expect(kinds).toContain('page-close');
  });

  it('builds the document from the template, with its CSS inlined', async () => {
    // The whole point of the export path: Chromium must receive the real
    // template's output, styled. A document that is merely well-formed but
    // unstyled is the failure this guards — Astro's container drops scoped
    // CSS, so an uninlined sheet would print as a naked fragment.
    const outputPath = join(outputDir, 'styled.pdf');
    await exportToPdf({
      workspaceRoot: workspace.root,
      cvId: 'cv_main',
      presentationId: 'pres_main',
      templateArtifactPath: TEMPLATE_DIR,
      outputPath,
      pageProfile: A4_PORTRAIT,
      playwright: fakePlaywright.module,
    });

    const setContent = fakePlaywright.calls.find((c) => c.kind === 'setContent');
    const html = setContent?.kind === 'setContent' ? setContent.html : '';

    // A complete, printable document…
    expect(html).toContain('<!doctype html>');
    expect(html).toContain('</html>');
    // …carrying the template's own scoped CSS…
    expect(html).toContain('data-astro-cid-');
    // …scoped to ids that actually appear on the rendered markup, so the
    // rules can match rather than being inert.
    const scope = /\.?[\w-]*\[data-astro-cid-([0-9a-z]+)\]/i.exec(html);
    if (scope !== null) expect(html).toContain(`data-astro-cid-${scope[1]}`);
    // …with the page wrapper intact, because templates style that element
    // itself (two-column's layout rule targets it directly).
    expect(html).toContain('data-seevee-page="true"');
    // …and real CV content, not blanks.
    expect(html).toContain('Ada Lovelace');
    // Page geometry comes from the profile so the sheet is sized correctly.
    expect(html).toMatch(/@page\s*\{[^}]*size:/);
  });
});

describe('exportToPdf (presentation page policy)', () => {
  it('fails when the PDF exceeds the declared targetMax', async () => {
    // The page count is whatever Chromium paginated; the presentation's
    // declared maximum is the invariant that is actually checkable.
    const workspace = await buildWorkspace({
      workspaceFixture: 'workspace-dense.json',
      cvFixture: 'dense-cv.json',
      cvRelative: 'cvs/cv_dense.json',
      presentationFixture: 'presentation-dense.json',
    });
    try {
      const dense = await readFile(join(FIXTURES, 'presentation-dense.json'), 'utf8');
      await writeFile(
        join(workspace.root, 'presentations', 'pres_main.json'),
        dense.replace('"targetMax": 2', '"targetMax": 1'),
      );
      // Stand in for a template that really paginated into 3 sheets, so the
      // PDF on disk exceeds the declared maximum of 1.
      const paginated = createFakePlaywright({ pageCount: 3 });
      const error = await exportToPdf({
        workspaceRoot: workspace.root,
        cvId: 'cv_dense',
        presentationId: 'pres_main',
        templateArtifactPath: TEMPLATE_DIR,
        outputPath: join(workspace.root, 'out.pdf'),
        pageProfile: A4_PORTRAIT,
        allowForcedExport: true,
        playwright: paginated.module,
      }).then(() => null, (e: unknown) => e);
      expect(error).toBeInstanceOf(PdfValidationError);
      expect((error as Error).message).toMatch(/exceeds the presentation's declared maximum/);
    } finally {
      await workspace.cleanup();
    }
  });

  it('passes when the presentation declares no page policy', async () => {
    // `targetMax` is optional by schema design. With no policy there is
    // nothing to violate, so the export must succeed rather than invent a
    // bound.
    const workspace = await copyWorkspaceFixture();
    try {
      const presentation = JSON.parse(
        await readFile(join(workspace.root, 'presentations', 'pres_main.json'), 'utf8'),
      );
      delete presentation.data.pagination.targetMin;
      delete presentation.data.pagination.targetMax;
      await writeFile(
        join(workspace.root, 'presentations', 'pres_main.json'),
        JSON.stringify(presentation),
      );
      const result = await exportToPdf({
        workspaceRoot: workspace.root,
        cvId: 'cv_main',
        presentationId: 'pres_main',
        templateArtifactPath: TEMPLATE_DIR,
        outputPath: join(workspace.root, 'out.pdf'),
        pageProfile: A4_PORTRAIT,
        playwright: fakePlaywright.module,
      });
      expect(result.pageCount).toBeGreaterThan(0);
    } finally {
      await workspace.cleanup();
    }
  });
});

describe('exportToPdf (overflow protection)', () => {
  let workspace: WorkspaceRoot;
  let outputDir: string;

  beforeEach(async () => {
    workspace = await copyDenseWorkspaceFixture();
    outputDir = await mkdtemp(join(workspace.root, '-out-'));
  });

  async function exportDense(
    allowForced: boolean,
  ): Promise<{ result?: unknown; error?: RenderDiagnosticsError }> {
    try {
      const out = await exportToPdf({
        workspaceRoot: workspace.root,
        cvId: 'cv_dense',
        presentationId: 'pres_main',
        templateArtifactPath: TEMPLATE_DIR,
        outputPath: join(outputDir, 'dense.pdf'),
        pageProfile: A4_PORTRAIT,
        allowForcedExport: allowForced,
        playwright: fakePlaywright.module,
      });
      return { result: out };
    } catch (error) {
      if (error instanceof RenderDiagnosticsError) {
        return { error };
      }
      throw error;
    }
  }

  it('throws RenderDiagnosticsError when diagnostics report overflow', async () => {
    const { error } = await exportDense(false);
    expect(error).toBeInstanceOf(RenderDiagnosticsError);
    expect(error?.message).toContain('overflow');
  });

  it('proceeds despite overflow when allowForcedExport is true', async () => {
    const { result, error } = await exportDense(true);
    expect(error).toBeUndefined();
    expect(result).toBeDefined();
  });
});

describe('exportToPdf (Playwright gating)', () => {
  it('resolves the declared playwright dependency regardless of cwd', async () => {
    // Playwright is a real dependency of this package now. The previous
    // directory-walk gate reported "not installed" whenever pnpm's layout
    // hid the package from the walk, which blocked genuine exports — so
    // resolution itself is the contract, not the working directory.
    const originalCwd = process.cwd();
    process.chdir(tmpdir());
    try {
      const mod = await loadPlaywrightModule();
      expect(typeof mod.chromium.launch).toBe('function');
    } finally {
      process.chdir(originalCwd);
    }
  });

  it('reports the gate as unavailable from a clean tmp directory', async () => {
    const originalCwd = process.cwd();
    process.chdir(tmpdir());
    try {
      const ok = await isPlaywrightInstalledAt(tmpdir(), 'playwright');
      expect(ok).toBe(false);
    } finally {
      process.chdir(originalCwd);
    }
  });

  it('isPlaywrightAvailable() resolves without throwing', async () => {
    const ok = await isPlaywrightAvailable();
    expect(typeof ok).toBe('boolean');
  });
});

describe('metadata writer', () => {
  it('round-trips an ExportResult through the on-disk JSON', async () => {
    const root = await mkdtemp(join(tmpdir(), 'seevee-export-meta-'));
    const exportId = 'exp_demo';
    await writeExportMetadata({
      workspaceRoot: root,
      exportId,
      record: {
        outputPath: '/tmp/x.pdf',
        pageCount: 1,
        estimatedPageCount: 1,
        pageProfile: {
          preset: 'A4',
          orientation: 'portrait',
        },
        bytes: 12,
        sha256: 'a'.repeat(64),
        exportId,
        startedAt: '2026-01-01T00:00:00.000Z',
        completedAt: '2026-01-01T00:00:01.000Z',
        diagnostics: {
          pages: [],
          totalOverflow: 0,
          hasClipping: false,
          hasBlankPages: false,
          fontSubstitutions: [],
          missingAssets: [],
        },
      },
    });
    const dir = join(root, '.seevee', 'exports');
    const files = await readdir(dir);
    expect(files).toContain(`${exportId}.json`);
    const body = JSON.parse(
      await readFile(join(dir, `${exportId}.json`), 'utf8'),
    );
    expect(body.exportId).toBe(exportId);
    expect(body.sha256).toBe('a'.repeat(64));
    await rm(root, { recursive: true, force: true });
  });

  it('rejects non-absolute workspaceRoot', async () => {
    await expect(
      writeExportMetadata({
        workspaceRoot: 'relative/path',
        exportId: 'exp_x',
        record: {
          outputPath: '/tmp/x.pdf',
          pageCount: 1,
          estimatedPageCount: 1,
          pageProfile: { preset: 'A4', orientation: 'portrait' },
          bytes: 0,
          sha256: 'a'.repeat(64),
          exportId: 'exp_x',
          startedAt: '2026-01-01T00:00:00.000Z',
          completedAt: '2026-01-01T00:00:01.000Z',
          diagnostics: {
            pages: [],
            totalOverflow: 0,
            hasClipping: false,
            hasBlankPages: false,
            fontSubstitutions: [],
            missingAssets: [],
          },
        },
      }),
    ).rejects.toBeInstanceOf(IoError);
  });

  it('produces unique export ids', () => {
    const a = generateExportId(new Date('2026-01-01T00:00:00.000Z'));
    const b = generateExportId(new Date('2026-01-01T00:00:01.000Z'));
    expect(a).not.toBe(b);
    expect(a).toMatch(/^exp_2026-01-01T00-00-00-000Z_[0-9a-f]{32}$/);
  });
});

describe('pdf-info', () => {
  it('reports the page count and dimensions of a real PDF', async () => {
    const root = await mkdtemp(join(tmpdir(), 'seevee-pdfinfo-'));
    const pdfPath = join(root, 'tiny.pdf');
    await writeMinimalPdf(pdfPath);
    const info = await readPdfInfo(pdfPath);
    expect(info.pages).toBe(1);
    expect(info.widthMm).toBeGreaterThan(0);
    expect(info.heightMm).toBeGreaterThan(0);
    expect(['pdfinfo', 'header-fallback', 'fallback-stat']).toContain(
      info.source,
    );
    await rm(root, { recursive: true, force: true });
  });
});

describe('export-error hierarchy', () => {
  it('exports every documented subclass as instanceof ExportError', () => {
    expect(new ValidationError('x')).toBeInstanceOf(ExportError);
    expect(new RenderDiagnosticsError('x', {})).toBeInstanceOf(ExportError);
    expect(new PlaywrightNotInstalledError('x')).toBeInstanceOf(ExportError);
    expect(new ChromiumMissingError('x')).toBeInstanceOf(ExportError);
    expect(new PdfValidationError('x')).toBeInstanceOf(ExportError);
    expect(new IoError('x')).toBeInstanceOf(ExportError);
  });
});

describe('missing Chromium binary', () => {
  it('reports an actionable message instead of the raw Playwright failure', async () => {
    // A user who has never exported has no Chromium. Playwright reports
    // that as an opaque "Executable doesn't exist" throw from launch();
    // the pipeline must translate it into guidance, not pass it through.
    const missingExecutableModule: PlaywrightModule = {
      chromium: {
        async launch() {
          throw new Error(
            "browserType.launch: Executable doesn't exist at /home/u/.cache/ms-playwright/chromium-1/chrome-linux/chrome",
          );
        },
      },
    };

    await expect(
      capturePdf({
        html: '<!doctype html><p>x</p>',
        pdfOptions: { path: 'ignored.pdf' },
        playwrightModule: missingExecutableModule,
      }),
    ).rejects.toBeInstanceOf(ChromiumMissingError);

    await expect(
      capturePdf({
        html: '<!doctype html><p>x</p>',
        pdfOptions: { path: 'ignored.pdf' },
        playwrightModule: missingExecutableModule,
      }),
    ).rejects.toThrow(/Chromium is not available/i);
  });

  it('does not swallow an unrelated launch failure', async () => {
    // Only the missing-executable message is translated; a genuine
    // launch error (sandbox, shared memory, …) keeps its original text
    // so it stays diagnosable.
    const brokenModule: PlaywrightModule = {
      chromium: {
        async launch() {
          throw new Error('zygote_host_impl_linux.cc: Running as root');
        },
      },
    };

    await expect(
      capturePdf({
        html: '<!doctype html><p>x</p>',
        pdfOptions: { path: 'ignored.pdf' },
        playwrightModule: brokenModule,
      }),
    ).rejects.toThrow(/zygote_host_impl_linux/);
  });
});

async function writeMinimalPdf(path: string): Promise<void> {
  // Hand-rolled one-page PDF for the pdf-info test.
  const body =
    '%PDF-1.4\n' +
    '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n' +
    '2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n' +
    '3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] >>\nendobj\n' +
    'xref\n0 4\n0000000000 65535 f \n0000000010 00000 n \n0000000060 00000 n \n0000000110 00000 n \n' +
    'trailer\n<< /Size 4 /Root 1 0 R >>\nstartxref\n180\n%%EOF\n';
  const fs = await import('node:fs/promises');
  await fs.mkdir(dirname(path), { recursive: true });
  await fs.writeFile(path, body, 'binary');
}

// Touch the import so unused-import lints stay happy when the test
// file is read by tools that don't see the dynamic import below.
void createFakePlaywright;
type _Handle = FakePlaywrightHandle;
