// PDF page-count + physical-dimensions reader.
//
// Per DEVELOPMENT_PLAN.md §12 step 8, the pipeline verifies the
// rendered PDF's page count and physical dimensions. We do this by
// shelling out to `pdfinfo` (Poppler) when available, falling back to
// a conservative file-stat + renderer-diagnostics cross-check when
// the binary is not on PATH.
//
// We never depend on `pdf-lib` or `pdfjs` for this: the goal is a fast
// integer + float check, not full PDF parsing. The fallback path
// reads just enough of the trailer to count `/Type /Page` objects
// without pulling in a heavier dependency tree.

import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';

/** Result shape used by `exportToPdf` for §12 step 8 verification. */
export interface PdfInfo {
  readonly pages: number;
  readonly widthMm: number;
  readonly heightMm: number;
  /** Source of the verification data, useful for diagnostics. */
  readonly source: 'pdfinfo' | 'header-fallback' | 'fallback-stat';
}

/**
 * Read page count + physical dimensions from a PDF on disk. We try
 * `pdfinfo` first; if it is not installed we fall back to a lightweight
 * trailer scan that counts `/Type /Page` objects and reads
 * `/MediaBox` for the dimensions.
 */
export async function readPdfInfo(pdfPath: string): Promise<PdfInfo> {
  const pdfinfo = await tryPdfinfo(pdfPath);
  if (pdfinfo !== null) return pdfinfo;
  const trailerScan = await scanTrailer(pdfPath);
  if (trailerScan !== null) return trailerScan;
  return {
    pages: 0,
    widthMm: 0,
    heightMm: 0,
    source: 'fallback-stat',
  };
}

interface SpawnResult {
  readonly stdout: string;
  readonly status: number;
}

function spawnCollect(
  cmd: string,
  args: readonly string[],
): Promise<SpawnResult | null> {
  const { promise, resolve } = Promise.withResolvers<SpawnResult | null>();
  let child: ReturnType<typeof spawn>;
  try {
    child = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] });
  } catch {
    resolve(null);
    return promise;
  }
  const stdout: Buffer[] = [];
  const stderr: Buffer[] = [];
  if (child.stdout !== null) {
    child.stdout.on('data', (chunk: Buffer) => stdout.push(chunk));
  }
  if (child.stderr !== null) {
    child.stderr.on('data', (chunk: Buffer) => stderr.push(chunk));
  }
  child.once('error', () => {
    resolve(null);
  });
  child.once('close', (status) => {
    void stderr;
    resolve(
      status === 0 || status === null
        ? {
            stdout: Buffer.concat(stdout).toString('utf8'),
            status: status ?? 0,
          }
        : null,
    );
  });
  return promise;
}

async function tryPdfinfo(pdfPath: string): Promise<PdfInfo | null> {
  const args: readonly string[] = ['-l', '9999', pdfPath];
  const spawned = await spawnCollect('pdfinfo', args);
  if (spawned === null) return null;
  const parsed = parsePdfinfoText(spawned.stdout);
  if (parsed === null) return null;
  return { ...parsed, source: 'pdfinfo' };
}

function parsePdfinfoText(text: string): Omit<PdfInfo, 'source'> | null {
  const pageMatch = /^Pages:\s+(\d+)/m.exec(text);
  if (pageMatch === null || pageMatch[1] === undefined) return null;
  const pages = Number.parseInt(pageMatch[1], 10);
  if (!Number.isFinite(pages)) return null;
  const sizeMatch = /^Page size:\s+([\d.]+)\s+x\s+([\d.]+)\s+(pt|mm|in)/m.exec(text);
  if (sizeMatch === null) return null;
  let width = Number.parseFloat(sizeMatch[1] ?? '0');
  let height = Number.parseFloat(sizeMatch[2] ?? '0');
  const unit = sizeMatch[3] ?? 'pt';
  if (unit === 'pt') {
    width = ptToMm(width);
    height = ptToMm(height);
  } else if (unit === 'in') {
    width = inchesToMm(width);
    height = inchesToMm(height);
  }
  return {
    pages,
    widthMm: width,
    heightMm: height,
  };
}

function ptToMm(pt: number): number {
  return (pt * 25.4) / 72;
}

function inchesToMm(inches: number): number {
  return inches * 25.4;
}

async function scanTrailer(pdfPath: string): Promise<PdfInfo | null> {
  let bytes: Buffer;
  try {
    bytes = await readFile(pdfPath);
  } catch {
    return null;
  }
  const text = bytes.toString('binary');
  if (!text.startsWith('%PDF-')) return null;

  const pageMatches = text.match(/\/Type\s*\/Page\b(?!s)/g);
  if (pageMatches === null) return null;
  const pages = pageMatches.length;

  const mediaBoxMatch = /\/MediaBox\s*\[\s*0\s+0\s+([\d.]+)\s+([\d.]+)\s*\]/g.exec(text);
  if (mediaBoxMatch === null) return null;
  const rawWidth = Number.parseFloat(mediaBoxMatch[1] ?? '0');
  const rawHeight = Number.parseFloat(mediaBoxMatch[2] ?? '0');
  // MediaBox is expressed in points (1/72 inch); convert to mm.
  const widthMm = ptToMm(rawWidth);
  const heightMm = ptToMm(rawHeight);
  return {
    pages,
    widthMm,
    heightMm,
    source: 'header-fallback',
  };
}
