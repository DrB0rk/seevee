/**
 * DOCX adapter.
 *
 * DOCX is a ZIP archive with `word/document.xml` containing the body. This
 * adapter ships a tiny zero-dependency ZIP reader that uses the native
 * `DecompressionStream('deflate-raw')` Web API to inflate stored entries,
 * then extracts paragraph text from `<w:p>` elements.
 *
 * If the zip cannot be parsed, the adapter falls back to a warning block.
 */

import { readFile } from 'node:fs/promises';
import { isAbsolute, resolve } from 'node:path';

import type { ExtractedBlock, ExtractedDocument, SourceInput } from '../types.js';
import {
  nowIso,
  sha256Prefixed,
  stableBlockId,
  stableSourceId,
} from '../internal.js';

/** One entry in the local file headers. */
interface ZipEntry {
  name: string;
  compressionMethod: number;
  compressedSize: number;
  uncompressedSize: number;
  /** Byte offset to the entry's data (after the local file header). */
  dataOffset: number;
}

/** Read exactly `n` bytes from `view` at `offset`. */
function readBytes(view: Uint8Array, offset: number, n: number): Uint8Array {
  return view.subarray(offset, offset + n);
}

/** Read a little-endian uint32 at `offset`. */
function readU32(view: Uint8Array, offset: number): number {
  const dv = new DataView(view.buffer, view.byteOffset, view.byteLength);
  return dv.getUint32(offset, true);
}

/** Read a little-endian uint16 at `offset`. */
function readU16(view: Uint8Array, offset: number): number {
  const dv = new DataView(view.buffer, view.byteOffset, view.byteLength);
  return dv.getUint16(offset, true);
}

const ZIP_LOCAL_FILE_HEADER = 0x04034b50;
const ZIP_CENTRAL_DIR_HEADER = 0x02014b50;

/**
 * Parse the local-file-header entries from the archive. Returns the entries
 * plus the total number of bytes scanned.
 */
function parseZipLocalHeaders(view: Uint8Array): { entries: ZipEntry[]; centralDirFound: boolean } {
  const entries: ZipEntry[] = [];
  let offset = 0;
  while (offset + 4 <= view.length) {
    const sig = readU32(view, offset);
    if (sig === ZIP_CENTRAL_DIR_HEADER) {
      // End of local-file-header chain.
      return { entries, centralDirFound: true };
    }
    if (sig !== ZIP_LOCAL_FILE_HEADER) {
      // Unknown / corrupt header — bail out.
      return { entries, centralDirFound: false };
    }
    // Skip version (2) + flags (2) + compression (2) + mod time (2) + mod date (2)
    // + crc (4) + compressed size (4) + uncompressed size (4) + name length (2) +
    // extra length (2) = 26 bytes after the signature.
    const compressionMethod = readU16(view, offset + 8);
    const compressedSize = readU32(view, offset + 18);
    const uncompressedSize = readU32(view, offset + 22);
    const nameLength = readU16(view, offset + 26);
    const extraLength = readU16(view, offset + 28);
    const nameStart = offset + 30;
    const nameBytes = readBytes(view, nameStart, nameLength);
    const name = new TextDecoder('utf-8').decode(nameBytes);
    const dataOffset = nameStart + nameLength + extraLength;

    if (dataOffset + compressedSize > view.length) {
      // Truncated — abort.
      return { entries, centralDirFound: false };
    }

    entries.push({
      name,
      compressionMethod,
      compressedSize,
      uncompressedSize,
      dataOffset,
    });
    offset = dataOffset + compressedSize;
  }
  return { entries, centralDirFound: false };
}

/** Inflate a stored entry using the native `DecompressionStream`. */
async function inflateRaw(compressed: Uint8Array): Promise<Uint8Array> {
  // 0 = stored, 8 = deflate. DOCX uses 8 for word/document.xml.
  const ds = new DecompressionStream('deflate-raw');
  const writer = ds.writable.getWriter();
  writer.write(compressed);
  writer.close();
  const chunks: Uint8Array[] = [];
  const reader = ds.readable.getReader();
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    if (value) chunks.push(value);
  }
  let total = 0;
  for (const c of chunks) total += c.length;
  const out = new Uint8Array(total);
  let pos = 0;
  for (const c of chunks) {
    out.set(c, pos);
    pos += c.length;
  }
  return out;
}

/** Decode the `word/document.xml` body into plain-text paragraphs. */
function parseDocumentXml(xml: string): string[] {
  const paragraphs: string[] = [];
  const paraRegex = /<w:p\b[^>]*>([\s\S]*?)<\/w:p>/g;
  const textRegex = /<w:t\b[^>]*>([\s\S]*?)<\/w:t>/g;
  let match: RegExpExecArray | null = paraRegex.exec(xml);
  while (match !== null) {
    const inner = match[1] ?? '';
    const texts: string[] = [];
    let textMatch: RegExpExecArray | null = textRegex.exec(inner);
    while (textMatch !== null) {
      const decoded = decodeXmlEntities(textMatch[1] ?? '');
      if (decoded.length > 0) texts.push(decoded);
      textMatch = textRegex.exec(inner);
    }
    const line = texts.join('').replace(/\s+/g, ' ').trim();
    if (line.length > 0) paragraphs.push(line);
    match = paraRegex.exec(xml);
  }
  return paragraphs;
}

function decodeXmlEntities(s: string): string {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_m, code) => {
      const n = Number(code);
      return Number.isFinite(n) ? String.fromCodePoint(n) : _m;
    });
}

function docxWarning(
  sourceId: string,
  hash: string,
  filePath: string,
  warning: string,
  extraMetadata: Record<string, unknown> = {},
): ExtractedDocument {
  return {
    sourceId,
    mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    hash,
    retrievedAt: nowIso(),
    fileName: filePath,
    blocks: [],
    warnings: [warning],
    metadata: { parser: 'native-zip', valid: false, ...extraMetadata },
  };
}

export async function extractDocx(
  input: SourceInput,
): Promise<ExtractedDocument> {
  if (input.kind !== 'file') {
    throw new Error(`extractDocx requires { kind: 'file' }, received '${input.kind}'`);
  }
  const filePath = isAbsolute(input.path) ? input.path : resolve(process.cwd(), input.path);
  const bytes = await readFile(filePath);
  const hash = sha256Prefixed(bytes);
  const sourceId = stableSourceId('docx', hash);

  let parsed: { entries: ZipEntry[]; centralDirFound: boolean };
  try {
    parsed = parseZipLocalHeaders(new Uint8Array(bytes));
  } catch (err) {
    return docxWarning(sourceId, hash, filePath, `docx parse error: ${(err as Error).message}`);
  }

  if (parsed.entries.length === 0) {
    return docxWarning(sourceId, hash, filePath, 'docx parse error: no entries found in archive');
  }

  const documentEntry = parsed.entries.find((e) => e.name === 'word/document.xml');
  if (!documentEntry) {
    return docxWarning(
      sourceId,
      hash,
      filePath,
      'docx parse error: word/document.xml not found in archive',
      { entryCount: parsed.entries.length },
    );
  }

  let xmlBytes: Uint8Array;
  try {
    const compressed = new Uint8Array(
      bytes.buffer,
      bytes.byteOffset + documentEntry.dataOffset,
      documentEntry.compressedSize,
    );
    if (documentEntry.compressionMethod === 0) {
      xmlBytes = compressed;
    } else if (documentEntry.compressionMethod === 8) {
      xmlBytes = await inflateRaw(compressed);
    } else {
      throw new Error(`unsupported compression method ${documentEntry.compressionMethod}`);
    }
  } catch (err) {
    return docxWarning(sourceId, hash, filePath, `docx inflate error: ${(err as Error).message}`);
  }

  const xml = new TextDecoder('utf-8').decode(xmlBytes);
  const paragraphs = parseDocumentXml(xml);
  const blocks: ExtractedBlock[] = paragraphs.map((text, index) => ({
    id: stableBlockId(hash, `paragraph:${index}`),
    type: 'paragraph' as const,
    text,
    sourceRef: `docx:paragraph:${index}`,
    confidence: 0.95,
  }));

  return {
    sourceId,
    mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    hash,
    retrievedAt: nowIso(),
    fileName: filePath,
    blocks,
    warnings: blocks.length === 0
      ? ['docx contained no extractable text']
      : ['no issues'],
    metadata: {
      parser: 'native-zip',
      valid: true,
      paragraphCount: paragraphs.length,
      entryCount: parsed.entries.length,
      hasCentralDirectory: parsed.centralDirFound,
    },
  };
}
