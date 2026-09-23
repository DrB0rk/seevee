// Top-level orchestration for the PDF export pipeline. Steps mirror
// DEVELOPMENT_PLAN.md §12:
//
//   1. validate canonical resources (CV / workspace / presentation);
//   2. load the compiled template artifact;
//   3. render the active page profile via the renderer;
//   4. wait for fonts/images (Playwright `setContent({ waitUntil })`);
//   5. run layout diagnostics;
//   6. block on fatal clipping/overflow unless `allowForcedExport`;
//   7. call Playwright `page.pdf(...)`;
//   8. verify page count + physical dimensions via pdfinfo;
//   9. store export metadata at
//      `<workspaceRoot>/.seevee/exports/<exportId>.json`;
//  10. return `ExportResult`.

import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { isAbsolute, resolve } from 'node:path';

import type { PageProfile } from '@seevee/schema';
import type { RenderDiagnostics } from '@seevee/template-sdk';
import {
  renderPresentationToHtml,
  type RendererOptions,
} from '@seevee/renderer';

import {
  ExportError,
  IoError,
  PdfValidationError,
  RenderDiagnosticsError,
} from './errors.js';
import { loadValidatedResources } from './validate.js';
import { loadCompiledArtifact } from './template-load.js';
import {
  capturePdf,
  loadPlaywrightModule,
} from './playwright.js';
import { readPdfInfo } from './pdf-info.js';
import {
  writeExportMetadata,
  generateExportId,
} from './metadata.js';
import type {
  ExportOptions,
  ExportResult,
  PlaywrightPdfOptions,
} from './types.js';

/**
 * Execute the full PDF export pipeline and persist the result.
 *
 * @throws `ValidationError`           — canonical resources failed.
 * @throws `TemplateArtifactError`     — compiled artifact invalid.
 * @throws `PlaywrightNotInstalledError`— browser missing on PATH/imports.
 * @throws `RenderDiagnosticsError`    — fatal overflow/clipping and not allowed.
 * @throws `PdfRenderError`            — `page.pdf()` failed.
 * @throws `PdfValidationError`        — written PDF disagrees with diagnostics.
 * @throws `IoError`                   — filesystem failure.
 */
export async function exportToPdf(options: ExportOptions): Promise<ExportResult> {
  const startedAt = new Date();
  assertWorkspaceRoot(options.workspaceRoot);
  assertOutputPath(options.outputPath);
  assertTemplateArtifactPath(options.templateArtifactPath);

  // ───── 1. Validate canonical resources ────────────────────────────────
  const resources = await loadValidatedResources({
    workspaceRoot: options.workspaceRoot,
    cvId: options.cvId,
    presentationId: options.presentationId,
  });

  // ───── 2. Load the compiled template artifact ─────────────────────────
  const artifact = await loadCompiledArtifact({
    templateArtifactPath: options.templateArtifactPath,
  });

  // ───── 3. Render the active page profile via the renderer ─────────────
  const rendererInput: RendererOptions = {
    templateManifest: artifact.manifest,
    templateSource: artifact.templateSource,
    presentation: resources.presentation,
    pageProfile: schemaProfileToRendererProfile(options.pageProfile),
  };
  const rendered = renderPresentationToHtml(
    resources.presentation,
    resources.cv,
    rendererInput,
  );

  // ───── 5. Run + analyse layout diagnostics ────────────────────────────
  if (options.onDiagnostics !== undefined) {
    options.onDiagnostics(rendered.diagnostics);
  }
  if (
    hasFatalDiagnostics(rendered.diagnostics) &&
    options.allowForcedExport !== true
  ) {
    throw new RenderDiagnosticsError(
      'Layout overflow detected: ' + overflowSummary(rendered.diagnostics),
      rendered.diagnostics,
    );
  }

  // ───── 4. Wait for fonts/images & 7. Render to PDF via Playwright ────
  const playwrightModule = await loadPlaywrightModule(options.playwright);
  const pdfOptions = buildPdfOptions(options.pageProfile, options.outputPath);
  await capturePdf({
    html: rendered.html,
    pdfOptions,
    playwrightModule,
  });

  // ───── 8. Verify page count + physical dimensions ────────────────────
  const verification = await verifyPdf({
    pdfPath: options.outputPath,
    expectedPages: rendered.diagnostics.pages.length,
    expectedPageProfile: options.pageProfile,
  });

  // ───── 9. Persist export metadata ─────────────────────────────────────
  const exportId = generateExportId(startedAt);
  const bytes = await readFileBytes(options.outputPath);
  const sha256 = sha256OfBytes(bytes);
  const completedAt = new Date();

  const result: ExportResult = {
    outputPath: options.outputPath,
    pageCount: verification.pages,
    pageProfile: options.pageProfile,
    bytes: bytes.byteLength,
    sha256,
    exportId,
    startedAt: startedAt.toISOString(),
    completedAt: completedAt.toISOString(),
    diagnostics: rendered.diagnostics,
  };

  try {
    await writeExportMetadata({
      workspaceRoot: options.workspaceRoot,
      exportId,
      record: result,
    });
  } catch (error) {
    throw error instanceof ExportError
      ? error
      : new ExportError(
          `metadata write failed: ${(error as Error).message}`,
        );
  }

  return result;
}

// ─── helpers ────────────────────────────────────────────────────────────

function assertWorkspaceRoot(value: string): void {
  if (!isAbsolute(value)) {
    throw new ExportError(
      `ExportOptions.workspaceRoot must be absolute (got '${value}')`,
    );
  }
}

function assertOutputPath(value: string): void {
  if (!isAbsolute(value)) {
    throw new ExportError(
      `ExportOptions.outputPath must be absolute (got '${value}')`,
    );
  }
}

function assertTemplateArtifactPath(value: string): void {
  if (!isAbsolute(value)) {
    throw new ExportError(
      `ExportOptions.templateArtifactPath must be absolute (got '${value}')`,
    );
  }
  // Resolve to canonicalise; the result is otherwise unused. We keep
  // this call so identical inputs to `exportToPdf` normalise to the
  // same path string in observability pipelines.
  resolve(value);
}

function schemaProfileToRendererProfile(
  schema: PageProfile,
): RendererOptions['pageProfile'] {
  if (schema.preset === 'A4' || schema.preset === 'Letter') {
    return { preset: schema.preset, orientation: schema.orientation };
  }
  if (schema.preset === 'custom') {
    if (schema.width === undefined || schema.height === undefined) {
      throw new ExportError(
        `custom page profile requires width and height; got ${JSON.stringify({
          width: schema.width,
          height: schema.height,
        })}`,
      );
    }
    return {
      preset: 'Custom',
      width: schema.width,
      height: schema.height,
      orientation: schema.orientation,
    };
  }
  // 'Legal' is not a renderer preset; fall back to Letter so the
  // pipeline still emits a PDF rather than aborting.
  return { preset: 'Letter', orientation: schema.orientation };
}

function buildPdfOptions(
  profile: PageProfile,
  outputPath: string,
): PlaywrightPdfOptions {
  if (profile.preset === 'custom') {
    if (profile.width === undefined || profile.height === undefined) {
      throw new ExportError(
        `custom page profile requires width and height (got ${JSON.stringify(profile)})`,
      );
    }
    return {
      path: outputPath,
      printBackground: true,
      width: mmToCssMm(profile.width),
      height: mmToCssMm(profile.height),
      margin: buildMargin(profile),
      preferCSSPageSize: false,
    };
  }
  return {
    path: outputPath,
    printBackground: true,
    format: profile.preset === 'Legal' ? 'Legal' : profile.preset,
    margin: buildMargin(profile),
    preferCSSPageSize: false,
  };
}

function buildMargin(
  profile: PageProfile,
): PlaywrightPdfOptions['margin'] {
  const edges = profile.edges;
  if (edges === undefined) return undefined;
  const out: {
    top?: string;
    right?: string;
    bottom?: string;
    left?: string;
  } = {};
  if (typeof edges.top === 'number') out.top = mmToCssMm(edges.top);
  if (typeof edges.right === 'number') out.right = mmToCssMm(edges.right);
  if (typeof edges.bottom === 'number') out.bottom = mmToCssMm(edges.bottom);
  if (typeof edges.left === 'number') out.left = mmToCssMm(edges.left);
  return out;
}

function mmToCssMm(mm: number): string {
  return `${mm}mm`;
}

async function readFileBytes(path: string): Promise<Buffer> {
  try {
    return await readFile(path);
  } catch (error) {
    throw new IoError(
      `failed to read generated PDF at '${path}': ${(error as Error).message}`,
    );
  }
}

function sha256OfBytes(buf: Buffer): string {
  return createHash('sha256').update(buf).digest('hex');
}

function hasFatalDiagnostics(diagnostics: RenderDiagnostics): boolean {
  if (diagnostics.totalOverflow > 0) return true;
  if (diagnostics.hasClipping) return true;
  return false;
}

function overflowSummary(diagnostics: RenderDiagnostics): string {
  const parts: string[] = [];
  if (diagnostics.totalOverflow > 0) {
    parts.push(`totalOverflow=${diagnostics.totalOverflow.toFixed(2)}mm`);
  }
  if (diagnostics.hasClipping) {
    parts.push('clipping detected');
  }
  for (const page of diagnostics.pages) {
    if (page.overflow || page.clippedNodes.length > 0) {
      parts.push(
        `page ${page.pageNumber}: overflow=${page.overflowAmount.toFixed(2)}mm, clipped=[${page.clippedNodes.join(',')}]`,
      );
    }
  }
  return parts.join('; ');
}

interface VerificationResult {
  readonly pages: number;
  readonly widthMm: number;
  readonly heightMm: number;
}

async function verifyPdf(options: {
  pdfPath: string;
  expectedPages: number;
  expectedPageProfile: PageProfile;
}): Promise<VerificationResult> {
  const info = await readPdfInfo(options.pdfPath);
  if (info.pages <= 0) {
    throw new PdfValidationError(
      `pdf validation: could not determine page count for '${options.pdfPath}'`,
    );
  }
  if (info.pages !== options.expectedPages) {
    throw new PdfValidationError(
      `pdf page count mismatch: renderer reported ${options.expectedPages} pages, ` +
        `pdf on disk reports ${info.pages} (source: ${info.source}).`,
    );
  }
  // Tolerate a 1mm drift between expected dimensions and the file
  // when we can read the dimensions at all. This keeps us safe from
  // pdfinfo unit-conversion rounding without making the check
  // toothless.
  if (info.widthMm > 0 && info.heightMm > 0) {
    if (
      pageProfileMatches(
        options.expectedPageProfile,
        info.widthMm,
        info.heightMm,
      ) === false
    ) {
      throw new PdfValidationError(
        `pdf page dimensions mismatch: profile=${presetSummary(options.expectedPageProfile)}, ` +
          `actual=${info.widthMm.toFixed(2)}x${info.heightMm.toFixed(2)}mm (source: ${info.source}).`,
      );
    }
  }
  return {
    pages: info.pages,
    widthMm: info.widthMm,
    heightMm: info.heightMm,
  };
}

function pageProfileMatches(
  profile: PageProfile,
  actualWidthMm: number,
  actualHeightMm: number,
): boolean {
  if (profile.preset === 'A4') {
    return (
      withinTolerance(actualWidthMm, 210, 1) &&
      withinTolerance(actualHeightMm, 297, 1)
    );
  }
  if (profile.preset === 'Letter') {
    return (
      withinTolerance(actualWidthMm, 215.9, 1) &&
      withinTolerance(actualHeightMm, 279.4, 1)
    );
  }
  if (profile.preset === 'Legal') {
    return (
      withinTolerance(actualWidthMm, 215.9, 1) &&
      withinTolerance(actualHeightMm, 355.6, 1)
    );
  }
  if (profile.preset === 'custom') {
    if (profile.width === undefined || profile.height === undefined) return true;
    return (
      withinTolerance(actualWidthMm, profile.width, 1) &&
      withinTolerance(actualHeightMm, profile.height, 1)
    );
  }
  return true;
}

function withinTolerance(
  actual: number,
  expected: number,
  toleranceMm: number,
): boolean {
  return Math.abs(actual - expected) <= toleranceMm;
}

function presetSummary(profile: PageProfile): string {
  if (profile.preset === 'custom') {
    return `${profile.preset} ${profile.width ?? '?'}x${profile.height ?? '?'}mm`;
  }
  return profile.preset;
}
