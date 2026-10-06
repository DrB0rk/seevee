/**
 * Image adapter — refuses the source instead of faking an extraction.
 *
 * Vision extraction is deliberately NOT implemented: it needs a provider API
 * key, costs money per image, and cannot be exercised in CI. An earlier
 * revision returned an `ExtractedDocument` whose single block was the literal
 * text `[image]`, which read downstream as a successful ingest while carrying
 * no content at all. This adapter therefore never returns a document; it
 * throws {@link VisionExtractionUnavailableError} with a message that tells the
 * user what to do instead.
 */

import { extname } from 'node:path';

import type { SourceInput } from '../types.js';

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

/**
 * Thrown when an image source reaches {@link extractImage}. The `code` is the
 * machine-readable contract; the message is written for the end user and
 * names a concrete alternative.
 */
export class VisionExtractionUnavailableError extends Error {
  public override readonly name = 'VisionExtractionUnavailableError';
  public readonly code = 'vision-extraction-unavailable';

  constructor(message: string) {
    super(message);
  }
}

/**
 * Always throws {@link VisionExtractionUnavailableError}. No file is read and
 * no `ExtractedDocument` is produced — callers must handle the rejection.
 */
export async function extractImage(
  input: SourceInput,
): Promise<never> {
  if (input.kind !== 'file') {
    throw new Error(`extractImage requires { kind: 'file' }, received '${input.kind}'`);
  }
  const mime = mimeFor(input.path);
  throw new VisionExtractionUnavailableError(
    `Image extraction is not available: Seevee cannot read text out of ${input.path} (${mime}) because this build ships no vision model. `
    + 'Paste the text from the image into the agent chat, or point the agent at that file path and let it open the image with the vision tooling of your configured agent session.',
  );
}