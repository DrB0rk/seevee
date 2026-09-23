// Fake Playwright module for the export pipeline tests.
//
// We implement only the surface `@seevee/export` consumes:
//
//   - `chromium.launch({ headless })`
//   - `browser.newPage()`
//   - `page.setContent(html, { waitUntil })`
//   - `page.pdf({ path, … })` — writes a minimal valid PDF whose
//     `/Count` matches the renderer-reported page count we observe
//     from the HTML (`<article class="seevee-page">` occurrences).
//     This keeps the on-disk verification step that runs after the
//     fake `pdf()` call honest.
//   - `page.close()`
//   - `browser.close()`
//
// The fake records every call so tests can assert the pipeline drove
// the lifecycle correctly without depending on a real Chromium.

import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

import type {
  PlaywrightBrowser,
  PlaywrightModule,
  PlaywrightPage,
  PlaywrightPdfOptions,
} from '../src/types.js';

export interface FakePlaywrightOptions {
  /** When true, `loadPlaywrightModule()` will throw. */
  readonly reportMissing?: boolean;
}

export interface FakePlaywrightHandle {
  readonly module: PlaywrightModule;
  readonly calls: FakePlaywrightCall[];
  /** Resolve the next pdf() promise (defaults to immediate). */
  resolveNextPdf(): void;
  /** Reject the next pdf() promise with the given error. */
  rejectNextPdf(error: Error): void;
}

export type FakePlaywrightCall =
  | { readonly kind: 'launch'; readonly headless: boolean | undefined }
  | { readonly kind: 'newPage' }
  | {
      readonly kind: 'setContent';
      readonly html: string;
      readonly waitUntil: string | undefined;
    }
  | {
      readonly kind: 'pdf';
      readonly options: PlaywrightPdfOptions;
      readonly bytesWritten: number;
    }
  | { readonly kind: 'page-close' }
  | { readonly kind: 'browser-close' };

/**
 * Build a fresh fake Playwright module. The handle is the only way
 * tests can inspect the recorded call list.
 */
export function createFakePlaywright(
  options: FakePlaywrightOptions = {},
): FakePlaywrightHandle {
  if (options.reportMissing === true) {
    throw new Error(
      'FakePlaywright: reportMissing must not be used for module construction; use the gate test to surface a missing module.',
    );
  }
  const calls: FakePlaywrightCall[] = [];

  let lastHtml = '';

  const fakePage: PlaywrightPage = {
    async setContent(html: string, opts): Promise<void> {
      lastHtml = html;
      calls.push({
        kind: 'setContent',
        html,
        waitUntil: opts?.waitUntil,
      });
    },
    async pdf(pdfOptions: PlaywrightPdfOptions): Promise<Uint8Array> {
      // Mirror the renderer's reported page count by counting
      // `<article class="seevee-page">` elements in the HTML we were
      // asked to render. Fall back to 1 when none are present.
      const pageCount = countPages(lastHtml);
      const buffer = buildMinimalPdf(pdfOptions, pageCount);
      await mkdir(dirname(pdfOptions.path), { recursive: true });
      await writeFile(pdfOptions.path, Buffer.from(buffer));
      calls.push({
        kind: 'pdf',
        options: pdfOptions,
        bytesWritten: buffer.byteLength,
      });
      return buffer;
    },
    async close(): Promise<void> {
      calls.push({ kind: 'page-close' });
    },
  };

  const fakeBrowser: PlaywrightBrowser = {
    async newPage(): Promise<PlaywrightPage> {
      calls.push({ kind: 'newPage' });
      return fakePage;
    },
    async close(): Promise<void> {
      calls.push({ kind: 'browser-close' });
    },
  };

  const fakeModule: PlaywrightModule = {
    chromium: {
      async launch(opts): Promise<PlaywrightBrowser> {
        calls.push({ kind: 'launch', headless: opts?.headless });
        return fakeBrowser;
      },
    },
  };

  return {
    module: fakeModule,
    calls,
    resolveNextPdf() {
      // No-op; tests may override via the call list.
    },
    rejectNextPdf(_error: Error) {
      // No-op; tests may simulate failures via rejected promises.
    },
  };
}

function countPages(html: string): number {
  const matches = html.match(/<article[^>]*class="seevee-page"/g);
  return matches === null ? 1 : matches.length;
}

/**
 * Build a maximally-minimal valid PDF document with the requested
 * page count and dimensions. The structure mirrors what Chromium's
 * `page.pdf()` writes for a multi-page export:
 *
 *   %PDF-1.4 header
 *   1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj
 *   2 0 obj << /Type /Pages /Kids [3 0 R 4 0 R ...] /Count N >> endobj
 *   3..N+2 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 w h] >> endobj
 *   xref / trailer.
 */
function buildMinimalPdf(
  options: PlaywrightPdfOptions,
  pageCount: number,
): Uint8Array {
  const safePages = Math.max(1, pageCount);
  let widthPt = 595; // A4 portrait in points
  let heightPt = 842;
  if (options.format === 'Letter') {
    widthPt = 612;
    heightPt = 792;
  } else if (options.format === 'A4' || options.format === undefined) {
    widthPt = 595;
    heightPt = 842;
  } else if (options.format === 'Legal') {
    widthPt = 612;
    heightPt = 1008;
  } else if (options.width !== undefined && options.height !== undefined) {
    widthPt = cssMmToPt(options.width);
    heightPt = cssMmToPt(options.height);
  }
  return composePdf(widthPt, heightPt, safePages);
}

function cssMmToPt(value: string): number {
  const m = /^([\d.]+)mm$/.exec(value);
  if (m === null || m[1] === undefined) return 595;
  const mm = Number.parseFloat(m[1]);
  return (mm * 72) / 25.4;
}

function composePdf(
  widthPt: number,
  heightPt: number,
  pageCount: number,
): Uint8Array {
  const objects: string[] = [];
  // Catalog
  objects.push('<< /Type /Catalog /Pages 2 0 R >>');
  // Pages
  const kids: string[] = [];
  for (let i = 0; i < pageCount; i += 1) {
    kids.push(`${3 + i} 0 R`);
  }
  objects.push(
    `<< /Type /Pages /Kids [${kids.join(' ')}] /Count ${pageCount} >>`,
  );
  // Page objects
  for (let i = 0; i < pageCount; i += 1) {
    objects.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${widthPt} ${heightPt}] >>`,
    );
  }
  const header = '%PDF-1.4\n';
  let body = header;
  const offsets: number[] = [];
  for (let i = 0; i < objects.length; i += 1) {
    offsets.push(Buffer.byteLength(body, 'binary'));
    body += `${i + 1} 0 obj\n${objects[i]}\nendobj\n`;
  }
  const xrefStart = Buffer.byteLength(body, 'binary');
  const xrefEntries = ['0000000000 65535 f '];
  for (let i = 0; i < objects.length; i += 1) {
    xrefEntries.push(
      `${(offsets[i] ?? 0).toString().padStart(10, '0')} 00000 n `,
    );
  }
  body += `xref\n0 ${objects.length + 1}\n${xrefEntries.join('\n')}\n`;
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\n`;
  body += `startxref\n${xrefStart}\n%%EOF\n`;
  return new Uint8Array(Buffer.from(body, 'binary'));
}
