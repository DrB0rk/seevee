/**
 * URL adapter.
 *
 * Fetches a remote URL with a 10-second timeout, then routes the response
 * through the HTML or text adapter based on the Content-Type header. SSRF
 * protections (private-IP rejection) are applied before the fetch. On any
 * failure the adapter returns `blocks: []` plus a descriptive warning.
 */

import { Buffer } from 'node:buffer';

import type { ExtractedBlock, ExtractedDocument, SourceInput } from '../types.js';
import {
  nowIso,
  sha256Prefixed,
  stableBlockId,
  stableSourceId,
  NO_ISSUES_WARNING,
} from '../internal.js';
import { extractHtml } from './html.js';
import { extractText } from './text.js';
import { describePrivateBlockReason, isPrivateUrl } from '../ssrf.js';

const FETCH_TIMEOUT_MS = 10_000;
const MAX_BODY_BYTES = 10 * 1024 * 1024; // 10 MiB hard cap

interface FetchOutcome {
  ok: boolean;
  status?: number;
  contentType?: string;
  body?: Uint8Array;
  warning?: string;
}

async function fetchWithTimeout(url: string): Promise<FetchOutcome> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      redirect: 'follow',
      signal: controller.signal,
      headers: { 'user-agent': 'seevee-ingest/0.1' },
    });
    const contentType = res.headers.get('content-type') ?? '';
    if (!res.body) {
      return { ok: false, status: res.status, contentType, warning: 'empty response body' };
    }
    const reader = res.body.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      if (!value) continue;
      total += value.length;
      if (total > MAX_BODY_BYTES) {
        try { await reader.cancel(); } catch { /* ignore */ }
        return {
          ok: false,
          status: res.status,
          contentType,
          warning: `response truncated: exceeded ${MAX_BODY_BYTES} bytes`,
        };
      }
      chunks.push(value);
    }
    const body = new Uint8Array(total);
    let pos = 0;
    for (const c of chunks) {
      body.set(c, pos);
      pos += c.length;
    }
    return { ok: true, status: res.status, contentType, body };
  } catch (err) {
    const name = (err as Error).name;
    const message = (err as Error).message;
    const reason = name === 'AbortError'
      ? `fetch aborted: timeout after ${FETCH_TIMEOUT_MS}ms`
      : `fetch error: ${message}`;
    return { ok: false, warning: reason };
  } finally {
    clearTimeout(timer);
  }
}

function selectMime(contentType: string): 'text/html' | 'text/plain' | 'application/octet-stream' {
  const ct = contentType.toLowerCase();
  if (ct.includes('html')) return 'text/html';
  if (ct.includes('json') || ct.includes('text')) return 'text/plain';
  return 'application/octet-stream';
}

export async function extractUrl(
  input: SourceInput,
): Promise<ExtractedDocument> {
  if (input.kind !== 'url') {
    throw new Error(`extractUrl requires { kind: 'url' }, received '${input.kind}'`);
  }
  const url = input.url;

  if (isPrivateUrl(url)) {
    const reason = await describePrivateBlockReason(url);
    const hash = sha256Prefixed(url);
    return {
      sourceId: stableSourceId('url', hash),
      mime: 'text/plain',
      hash,
      retrievedAt: nowIso(),
      url,
      blocks: [],
      warnings: [reason],
      metadata: { parser: 'fetch', status: 'ssrf-rejected' },
    };
  }

  const outcome = await fetchWithTimeout(url);
  if (!outcome.ok || !outcome.body) {
    const hash = sha256Prefixed(url);
    const warning = outcome.warning ?? 'fetch failed';
    return {
      sourceId: stableSourceId('url', hash),
      mime: 'application/octet-stream',
      hash,
      retrievedAt: nowIso(),
      url,
      blocks: [],
      warnings: [warning],
      metadata: {
        parser: 'fetch',
        status: outcome.status,
        contentType: outcome.contentType,
      },
    };
  }

  const mime = selectMime(outcome.contentType ?? '');
  const text = new TextDecoder('utf-8', { fatal: false }).decode(Buffer.from(outcome.body));
  const hash = sha256Prefixed(outcome.body);

  if (mime === 'text/html') {
    const extracted = await extractHtml({ kind: 'text', content: text });
    return {
      ...extracted,
      hash,
      url,
      retrievedAt: nowIso(),
      mime,
      warnings: [
        ...extracted.warnings,
        `fetched from ${url} (status ${outcome.status ?? 'unknown'})`,
      ],
      metadata: {
        ...extracted.metadata,
        url,
        contentType: outcome.contentType,
        status: outcome.status,
      },
    };
  }

  const extracted = await extractText({ kind: 'text', content: text });
  return {
    ...extracted,
    hash,
    url,
    retrievedAt: nowIso(),
    mime,
    warnings: [
      ...extracted.warnings,
      `fetched from ${url} (status ${outcome.status ?? 'unknown'})`,
    ],
    metadata: {
      ...extracted.metadata,
      url,
      contentType: outcome.contentType,
      status: outcome.status,
    },
  };
}

// Re-export the type guard for downstream consumers; helps typed imports.
export type { ExtractedBlock };
