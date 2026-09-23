/**
 * Image adapter (stub).
 *
 * Emits a single placeholder block. Vision-model integration is deferred to a
 * later pipeline stage (see DEVELOPMENT_PLAN §6 ingestion agents).
 */

import { extname } from 'node:path';
import { readFile } from 'node:fs/promises';

import type { ExtractedBlock, ExtractedDocument, SourceInput } from '../types.js';
import {
  nowIso,
  sha256Prefixed,
  stableBlockId,
  stableSourceId,
} from '../internal.js';

const IMAGE_EXT_TO_MIME: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.bmp': 'image/bmp',
  '.svg': 'image/svg+xml',
  '.tiff': 'image/tiff',
  '.heic': 'image/heic',
};

function mimeFor(filePath: string): string {
  const ext = extname(filePath).toLowerCase();
  return IMAGE_EXT_TO_MIME[ext] ?? 'application/octet-stream';
}

export async function extractImage(
  input: SourceInput,
): Promise<ExtractedDocument> {
  if (input.kind !== 'file') {
    throw new Error(`extractImage requires { kind: 'file' }, received '${input.kind}'`);
  }
  const bytes = await readFile(input.path);
  const hash = sha256Prefixed(bytes);
  const mime = mimeFor(input.path);
  const block: ExtractedBlock = {
    id: stableBlockId(hash, 'image:0'),
    type: 'image',
    text: '[image]',
    sourceRef: 'image:0',
    confidence: 0,
  };
  return {
    sourceId: stableSourceId('image', hash),
    mime,
    hash,
    retrievedAt: nowIso(),
    fileName: input.path,
    blocks: [block],
    warnings: ['vision extraction deferred to downstream pipeline'],
    metadata: {
      byteSize: bytes.length,
      visionStage: 'deferred',
    },
  };
}
