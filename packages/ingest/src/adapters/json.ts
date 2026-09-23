/**
 * JSON adapter.
 *
 * - If the parsed object matches the Seevee CV envelope (`kind: "seevee.cv"`),
 *   emit one block per top-level section/entity group with high confidence.
 * - Otherwise treat the input as raw text and emit paragraph/list blocks.
 * - Parse errors surface as warnings rather than throwing — adapters always
 *   return an `ExtractedDocument`.
 */

import type { ExtractedBlock, ExtractedDocument, SourceInput } from '../types.js';
import {
  clampConfidence,
  nowIso,
  sha256Prefixed,
  stableBlockId,
  stableSourceId,
} from '../internal.js';

const SEEVEE_CV_KIND = 'seevee.cv';
const SEEVEE_SOURCE_KIND = 'seevee.source';

function parseJson(content: string): { ok: true; value: unknown } | { ok: false; error: string } {
  try {
    return { ok: true, value: JSON.parse(content) };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Detect a Seevee CV envelope. */
function detectCv(value: unknown): value is Record<string, unknown> & { kind: string; data?: Record<string, unknown> } {
  if (!isPlainObject(value)) return false;
  if (value['kind'] === SEEVEE_CV_KIND) return true;
  // Allow detection when a `cv`-shaped nested object appears.
  if (isPlainObject(value['cv']) && (value['cv'] as Record<string, unknown>)['kind'] === SEEVEE_CV_KIND) {
    return true;
  }
  return false;
}

function extractFromCv(value: Record<string, unknown>): ExtractedBlock[] {
  const blocks: ExtractedBlock[] = [];
  const cvRoot = value['kind'] === SEEVEE_CV_KIND ? value : (value['cv'] as Record<string, unknown>);
  const data = isPlainObject(cvRoot['data']) ? cvRoot['data'] as Record<string, unknown> : null;
  const identity = isPlainObject(data?.['identity']) ? data!['identity'] as Record<string, unknown> : null;

  if (identity) {
    const name = typeof identity['fullName'] === 'string'
      ? identity['fullName'] as string
      : JSON.stringify(identity);
    blocks.push({
      id: stableBlockId('cv', 'identity:0'),
      type: 'paragraph',
      text: name,
      sourceRef: 'cv:identity',
      confidence: 0.97,
    });
  }

  const sections = isPlainObject(data?.['sections']) ? data!['sections'] as Record<string, unknown> : {};
  let sectionIndex = 0;
  for (const [sectionName, section] of Object.entries(sections)) {
    blocks.push({
      id: stableBlockId('cv', `section:${sectionIndex}`),
      type: 'heading',
      text: sectionName,
      sourceRef: `cv:sections/${sectionName}`,
      confidence: 0.97,
    });
    if (isPlainObject(section) && Array.isArray(section['bullets'])) {
      let bulletIndex = 0;
      for (const bullet of section['bullets'] as unknown[]) {
        if (typeof bullet === 'string') {
          blocks.push({
            id: stableBlockId('cv', `section:${sectionIndex}/bullet:${bulletIndex}`),
            type: 'list-item',
            text: bullet,
            sourceRef: `cv:sections/${sectionName}/bullet:${bulletIndex}`,
            confidence: 0.95,
          });
          bulletIndex += 1;
        }
      }
    }
    sectionIndex += 1;
  }

  return blocks;
}

/** Flatten arbitrary JSON value into text blocks using a stable order. */
function flattenAsText(value: unknown, hash: string): ExtractedBlock[] {
  const blocks: ExtractedBlock[] = [];
  let counter = 0;

  const visit = (node: unknown, prefix: string): void => {
    if (node === null || node === undefined) {
      return;
    }
    if (typeof node === 'string') {
      if (node.trim().length === 0) return;
      blocks.push({
        id: stableBlockId(hash, `${prefix}:${counter}`),
        type: 'paragraph',
        text: node,
        sourceRef: `${prefix}:${counter}`,
        confidence: 0.7,
      });
      counter += 1;
      return;
    }
    if (typeof node === 'number' || typeof node === 'boolean') {
      blocks.push({
        id: stableBlockId(hash, `${prefix}:${counter}`),
        type: 'paragraph',
        text: String(node),
        sourceRef: `${prefix}:${counter}`,
        confidence: 0.7,
      });
      counter += 1;
      return;
    }
    if (Array.isArray(node)) {
      node.forEach((entry, index) => {
        visit(entry, `${prefix}/${index}`);
      });
      return;
    }
    if (isPlainObject(node)) {
      for (const [key, child] of Object.entries(node)) {
        visit(child, `${prefix}/${key}`);
      }
    }
  };

  visit(value, 'json');
  return blocks;
}

export async function extractJson(
  input: SourceInput,
): Promise<ExtractedDocument> {
  if (input.kind !== 'text') {
    throw new Error(`extractJson requires { kind: 'text' }, received '${input.kind}'`);
  }
  const content = input.content;
  const hash = sha256Prefixed(content);

  const parsed = parseJson(content);
  if (!parsed.ok) {
    const sourceId = stableSourceId('json', hash);
    return {
      sourceId,
      mime: 'application/json',
      hash,
      retrievedAt: nowIso(),
      blocks: [],
      warnings: [`json parse error: ${parsed.error}`],
      metadata: { parser: 'native-json', valid: false },
    };
  }

  const value: Record<string, unknown> = isPlainObject(parsed.value) ? parsed.value : {};
  const isCv = detectCv(value);
  const isSource = value['kind'] === SEEVEE_SOURCE_KIND;
  const blocks = isCv
    ? extractFromCv(value)
    : flattenAsText(parsed.value, hash);

  const sourceId = stableSourceId('json', hash);
  const confidence = isCv ? 0.97 : isSource ? 0.85 : 0.7;

  return {
    sourceId,
    mime: 'application/json',
    hash,
    retrievedAt: nowIso(),
    blocks: blocks.map((b) => ({ ...b, confidence: clampConfidence(b.confidence * confidence) })),
    warnings: blocks.length === 0
      ? ['empty JSON produced no blocks']
      : isCv
        ? ['structured: detected seevee.cv envelope']
        : ['unstructured: JSON treated as raw text'],
    metadata: {
      parser: 'native-json',
      detectedKind: isCv ? SEEVEE_CV_KIND : isSource ? SEEVEE_SOURCE_KIND : 'unstructured',
      valid: true,
    },
  };
}
