/**
 * PDF adapter.
 *
 * Spawns `pdftotext` from poppler-utils as a child process. If the binary is
 * not available, or the file is unreadable, the adapter falls back to a
 * single warning block so downstream stages can flag the gap rather than
 * receive empty input.
 */

import { spawn } from 'node:child_process';
import { readFile, stat } from 'node:fs/promises';
import { isAbsolute, resolve } from 'node:path';

import type { ExtractedBlock, ExtractedDocument, SourceInput } from '../types.js';
import {
  nowIso,
  sha256Prefixed,
  stableBlockId,
  stableSourceId,
} from '../internal.js';

const PDFTOTEXT_BIN = 'pdftotext';
const SPAWN_TIMEOUT_MS = 15_000;

interface SpawnResult {
  ok: boolean;
  stdout: string;
  stderr: string;
  /** 'success' | 'not-found' | 'spawn-error' | 'timeout' | 'non-zero' */
  status: 'success' | 'not-found' | 'spawn-error' | 'timeout' | 'non-zero';
}

function runPdftotext(filePath: string): Promise<SpawnResult> {
  return new Promise<SpawnResult>((resolvePromise) => {
    let child;
    try {
      child = spawn(PDFTOTEXT_BIN, ['-layout', '-q', filePath, '-'], {
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    } catch (err) {
      resolvePromise({
        ok: false,
        stdout: '',
        stderr: (err as Error).message,
        status: 'spawn-error',
      });
      return;
    }
    if (!child) {
      resolvePromise({ ok: false, stdout: '', stderr: 'spawn returned null child', status: 'spawn-error' });
      return;
    }

    let stdout = '';
    let stderr = '';
    let settled = false;

    const settle = (result: SpawnResult): void => {
      if (settled) return;
      settled = true;
      try { child.kill('SIGKILL'); } catch { /* already gone */ }
      resolvePromise(result);
    };

    child.stdout?.on('data', (chunk: Buffer) => { stdout += chunk.toString('utf8'); });
    child.stderr?.on('data', (chunk: Buffer) => { stderr += chunk.toString('utf8'); });
    child.on('error', (err) => {
      const code = (err as NodeJS.ErrnoException).code;
      settle({
        ok: false,
        stdout,
        stderr: stderr + err.message,
        status: code === 'ENOENT' ? 'not-found' : 'spawn-error',
      });
    });
    child.on('close', (code) => {
      if (code === 0) {
        settle({ ok: true, stdout, stderr, status: 'success' });
      } else {
        settle({ ok: false, stdout, stderr, status: 'non-zero' });
      }
    });

    const timer = setTimeout(() => {
      settle({ ok: false, stdout, stderr: stderr + '\ntimeout', status: 'timeout' });
    }, SPAWN_TIMEOUT_MS);
    child.on('close', () => clearTimeout(timer));
  });
}

function splitPdfText(text: string): ExtractedBlock[] {
  // pdftotext with -layout tends to emit form-feed-separated pages when it
  // can detect them; treat both \f and blank lines as page boundaries.
  const pages = text.split(/\f+/).map((p) => p.trim()).filter((p) => p.length > 0);
  const fallback = pages.length > 0 ? pages : text.split(/\n{2,}/).map((p) => p.trim()).filter((p) => p.length > 0);
  const blocks: ExtractedBlock[] = [];
  fallback.forEach((page, pageIdx) => {
    const lines = page.split('\n');
    let paragraphBuffer: string[] = [];
    const flushParagraph = (): void => {
      if (paragraphBuffer.length === 0) return;
      const text2 = paragraphBuffer.join(' ').trim();
      paragraphBuffer = [];
      if (text2.length === 0) return;
      blocks.push({
        id: stableBlockId('pdf', `page:${pageIdx}/paragraph:${blocks.length}`),
        type: 'paragraph',
        text: text2,
        sourceRef: `pdf:page=${pageIdx}/paragraph:${blocks.length}`,
        confidence: 0.85,
      });
    };
    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed.length === 0) {
        flushParagraph();
        continue;
      }
      paragraphBuffer.push(trimmed);
    }
    flushParagraph();
  });
  return blocks;
}

export async function extractPdf(
  input: SourceInput,
): Promise<ExtractedDocument> {
  if (input.kind !== 'file') {
    throw new Error(`extractPdf requires { kind: 'file' }, received '${input.kind}'`);
  }
  const filePath = isAbsolute(input.path) ? input.path : resolve(process.cwd(), input.path);
  const fileStat = await stat(filePath).catch((err: NodeJS.ErrnoException) => {
    if (err.code === 'ENOENT') {
      throw new Error(`extractPdf: file not found: ${filePath}`);
    }
    throw err;
  });
  const hash = sha256Prefixed(await readFile(filePath));

  const sourceId = stableSourceId('pdf', hash);
  const result = await runPdftotext(filePath);

  if (!result.ok) {
    const warningMessage = result.status === 'not-found'
      ? 'PDF text extraction unavailable: pdftotext not installed'
      : result.status === 'timeout'
        ? `PDF text extraction unavailable: pdftotext timed out after ${SPAWN_TIMEOUT_MS}ms`
        : `PDF text extraction unavailable: pdftotext ${result.status} (${result.stderr.trim() || 'no stderr'})`;
    return {
      sourceId,
      mime: 'application/pdf',
      hash,
      retrievedAt: nowIso(),
      fileName: filePath,
      blocks: [{
        id: stableBlockId(hash, 'warning:0'),
        type: 'paragraph',
        text: `[pdf: ${filePath}]`,
        sourceRef: 'pdf:warning',
        confidence: 0,
      }],
      warnings: [warningMessage],
      metadata: {
        parser: 'pdftotext',
        status: result.status,
        byteSize: fileStat.size,
      },
    };
  }

  const blocks = splitPdfText(result.stdout);
  const pageCount = result.stdout.split(/\f+/).filter((p) => p.trim().length > 0).length;

  return {
    sourceId,
    mime: 'application/pdf',
    hash,
    retrievedAt: nowIso(),
    fileName: filePath,
    blocks,
    warnings: blocks.length === 0
      ? ['PDF contained no extractable text (may be image-only)']
      : ['no issues'],
    metadata: {
      parser: 'pdftotext',
      status: 'success',
      byteSize: fileStat.size,
      pageCount,
    },
  };
}
