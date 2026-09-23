/**
 * YAML adapter.
 *
 * Parses YAML and emits blocks. CV-shaped documents (`kind: seevee.cv` or a
 * top-level `cv:` mapping with that discriminator) are emitted as
 * structured blocks with high confidence. Plain maps fall back to a flat
 * key/value rendering.
 */

import { load as parseYaml } from 'js-yaml';

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

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function detectCv(value: unknown): value is Record<string, unknown> & { kind: string } {
  if (!isPlainObject(value)) return false;
  if (value['kind'] === SEEVEE_CV_KIND) return true;
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

function flattenAsKeyValues(value: unknown, hash: string): ExtractedBlock[] {
  const blocks: ExtractedBlock[] = [];
  let counter = 0;

  const visit = (node: unknown, prefix: string): void => {
    if (node === null || node === undefined) return;
    if (typeof node === 'string' || typeof node === 'number' || typeof node === 'boolean') {
      blocks.push({
        id: stableBlockId(hash, `kv:${counter}`),
        type: 'paragraph',
        text: `${prefix}: ${String(node)}`,
        sourceRef: `kv:${counter}`,
        confidence: 0.75,
      });
      counter += 1;
      return;
    }
    if (Array.isArray(node)) {
      node.forEach((entry, index) => visit(entry, `${prefix}[${index}]`));
      return;
    }
    if (isPlainObject(node)) {
      for (const [key, child] of Object.entries(node)) {
        visit(child, prefix === '' ? key : `${prefix}.${key}`);
      }
    }
  };

  visit(value, '');
  return blocks;
}

export async function extractYaml(
  input: SourceInput,
): Promise<ExtractedDocument> {
  if (input.kind !== 'text') {
    throw new Error(`extractYaml requires { kind: 'text' }, received '${input.kind}'`);
  }
  const content = input.content;
  const hash = sha256Prefixed(content);

  let parsed: unknown;
  try {
    parsed = parseYaml(content, { filename: 'source.yaml' });
  } catch (err) {
    return {
      sourceId: stableSourceId('yaml', hash),
      mime: 'application/yaml',
      hash,
      retrievedAt: nowIso(),
      blocks: [],
      warnings: [`yaml parse error: ${(err as Error).message}`],
      metadata: { parser: 'js-yaml', valid: false },
    };
  }

  const value: Record<string, unknown> = isPlainObject(parsed) ? parsed : {};
  const isCv = detectCv(value);
  const isSource = value['kind'] === SEEVEE_SOURCE_KIND;
  const blocks = isCv
    ? extractFromCv(value)
    : flattenAsKeyValues(parsed, hash);
  const baseConfidence = isCv ? 0.97 : isSource ? 0.85 : 0.75;

  return {
    sourceId: stableSourceId('yaml', hash),
    mime: 'application/yaml',
    hash,
    retrievedAt: nowIso(),
    blocks: blocks.map((b) => ({ ...b, confidence: clampConfidence(b.confidence * baseConfidence) })),
    warnings: blocks.length === 0
      ? ['empty YAML produced no blocks']
      : isCv
        ? ['structured: detected seevee.cv envelope']
        : ['unstructured: YAML rendered as flat key/value list'],
    metadata: {
      parser: 'js-yaml',
      detectedKind: isCv ? SEEVEE_CV_KIND : isSource ? SEEVEE_SOURCE_KIND : 'unstructured',
      valid: true,
    },
  };
}
