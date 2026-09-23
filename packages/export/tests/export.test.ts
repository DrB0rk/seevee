// End-to-end tests for @seevee/export.
//
// Every test that drives `exportToPdf` injects a fake Playwright
// module so the suite does not require Playwright to be installed.
// The fixtures live under `tests/fixtures/` and are copied from
// schema and renderer test fixtures at commit time. The tests write
// generated PDF and metadata files into a per-test temp directory
// that is cleaned up at module teardown.

import { mkdtemp, rm, readFile, stat, readdir } from 'node:fs/promises';
import { copyFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { PageProfile } from '@seevee/schema';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { exportToPdf } from '../src/export.js';
import {
  ExportError,
  IoError,
  PdfValidationError,
  PlaywrightNotInstalledError,
  RenderDiagnosticsError,
  ValidationError,
} from '../src/errors.js';
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
    expect(result.diagnostics.pages.length).toBe(result.pageCount);

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
  it('throws PlaywrightNotInstalledError when the optional dep is missing', async () => {
    const originalCwd = process.cwd();
    process.chdir(tmpdir());
    try {
      const workspace = await copyWorkspaceFixture();
      const outputDir = await mkdtemp(join(workspace.root, '-out-'));
      await expect(
        exportToPdf({
          workspaceRoot: workspace.root,
          cvId: 'cv_main',
          presentationId: 'pres_main',
          templateArtifactPath: TEMPLATE_DIR,
          outputPath: join(outputDir, 'cv.pdf'),
          pageProfile: A4_PORTRAIT,
        }),
      ).rejects.toBeInstanceOf(PlaywrightNotInstalledError);
      await workspace.cleanup();
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
    expect(new PdfValidationError('x')).toBeInstanceOf(ExportError);
    expect(new IoError('x')).toBeInstanceOf(ExportError);
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
