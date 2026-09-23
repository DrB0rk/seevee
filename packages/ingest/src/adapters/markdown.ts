/**
 * Markdown adapter.
 *
 * Parses headings, paragraphs, list items, code blocks, and pipe tables
 * using deterministic line-driven rules. Hierarchy is preserved via the
 * sourceRef (`heading:2#0/paragraph:0`); downstream stages re-assemble the
 * tree if needed.
 */

import type { ExtractedBlock, ExtractedDocument, SourceInput } from '../types.js';
import {
  clampConfidence,
  nowIso,
  sha256Prefixed,
  stableBlockId,
  stableSourceId,
  NO_ISSUES_WARNING,
} from '../internal.js';

interface MdToken {
  type: 'heading' | 'paragraph' | 'list-item' | 'code-block' | 'table-row' | 'divider';
  text: string;
  /** Headings: 1–6. List items: indent depth (1-based). */
  level?: number;
  /** Cells for `table-row` tokens. */
  cells?: string[];
}

function normaliseLine(raw: string): string {
  return raw.replace(/\s+$/, '');
}

function tokenise(content: string): MdToken[] {
  const lines = content.replace(/\r\n?/g, '\n').split('\n').map(normaliseLine);
  const tokens: MdToken[] = [];

  let i = 0;
  let paragraph: string[] = [];

  const flushParagraph = (): void => {
    if (paragraph.length === 0) return;
    const text = paragraph.join(' ').trim();
    if (text.length > 0) tokens.push({ type: 'paragraph', text });
    paragraph = [];
  };

  while (i < lines.length) {
    const line = lines[i] ?? '';
    const trimmed = line.trim();

    // Fenced code block.
    if (/^```/.test(trimmed)) {
      flushParagraph();
      const buf: string[] = [];
      i += 1;
      while (i < lines.length && !/^```/.test(lines[i]?.trim() ?? '')) {
        buf.push(lines[i] ?? '');
        i += 1;
      }
      if (i < lines.length) i += 1;
      tokens.push({ type: 'code-block', text: buf.join('\n') });
      continue;
    }

    // Horizontal rule.
    if (/^[-_*]{3,}\s*$/.test(trimmed)) {
      flushParagraph();
      tokens.push({ type: 'divider', text: trimmed });
      i += 1;
      continue;
    }

    // ATX heading.
    const heading = /^(#{1,6})\s+(.+?)\s*#*\s*$/.exec(trimmed);
    if (heading) {
      flushParagraph();
      const hashes = heading[1] ?? '';
      const text = heading[2] ?? '';
      tokens.push({ type: 'heading', text, level: hashes.length });
      i += 1;
      continue;
    }

    // Pipe table.
    if (/^\s*\|/.test(line) && i + 1 < lines.length && /^\s*\|?\s*:?-{1,}/.test(lines[i + 1] ?? '')) {
      flushParagraph();
      const headerCells = splitTableRow(line);
      tokens.push({ type: 'table-row', text: headerCells.join(' | '), cells: headerCells });
      i += 2;
      while (i < lines.length && /^\s*\|/.test(lines[i] ?? '')) {
        const cells = splitTableRow(lines[i] ?? '');
        tokens.push({ type: 'table-row', text: cells.join(' | '), cells });
        i += 1;
      }
      continue;
    }

    // List items (ordered or unordered).
    const ul = /^\s*[-*+]\s+(.+)$/.exec(line);
    if (ul) {
      flushParagraph();
      const indent = line.length - (line.trimStart().length);
      const depth = Math.min(4, Math.floor(indent / 2) + 1);
      tokens.push({ type: 'list-item', text: (ul[1] ?? '').trim(), level: depth });
      i += 1;
      continue;
    }
    const ol = /^\s*\d+[.)]\s+(.+)$/.exec(line);
    if (ol) {
      flushParagraph();
      const indent = line.length - (line.trimStart().length);
      const depth = Math.min(4, Math.floor(indent / 2) + 1);
      tokens.push({ type: 'list-item', text: (ol[1] ?? '').trim(), level: depth });
      i += 1;
      continue;
    }

    if (trimmed.length === 0) {
      flushParagraph();
      i += 1;
      continue;
    }

    paragraph.push(line);
    i += 1;
  }

  flushParagraph();
  return tokens;
}

function splitTableRow(line: string): string[] {
  return line
    .replace(/^\s*\|/, '')
    .replace(/\|\s*$/, '')
    .split('|')
    .map((cell) => cell.trim());
}

/** Build the heading path prefix for a heading at `level` from the current
 *  registry of last-seen heading references at each level. */
function headingPath(lastHeadingRef: ReadonlyArray<string>, level: number): string {
  const parts: string[] = [];
  for (let l = 1; l < level; l += 1) {
    const ref = lastHeadingRef[l];
    if (ref) parts.push(ref);
  }
  return parts.length === 0 ? '' : `${parts.join('/')}/`;
}

export async function extractMarkdown(
  input: SourceInput,
): Promise<ExtractedDocument> {
  if (input.kind !== 'text') {
    throw new Error(`extractMarkdown requires { kind: 'text' }, received '${input.kind}'`);
  }
  const content = input.content;
  const hash = sha256Prefixed(content);
  const sourceId = stableSourceId('md', hash);
  const tokens = tokenise(content);

  let headingIndex = 0;
  let paragraphIndex = 0;
  let listIndex = 0;
  let codeIndex = 0;
  let tableRowIndex = 0;
  let dividerIndex = 0;
  /** Counter of headings seen at each level (index 0 unused). */
  const headingsAtLevel: number[] = [0, 0, 0, 0, 0, 0, 0];
  /** Reference of the most recent heading at each level; empty when none. */
  const lastHeadingRef: string[] = ['', '', '', '', '', '', ''];

  const blocks: ExtractedBlock[] = tokens.map((token) => {
    let locator: string;
    let type: ExtractedBlock['type'];
    let confidence: number;

    switch (token.type) {
      case 'heading': {
        type = 'heading';
        const level = token.level ?? 1;
        headingsAtLevel[level] = (headingsAtLevel[level] ?? 0) + 1;
        // Clear any deeper headings — they're no longer ancestors.
        for (let l = level + 1; l <= 6; l += 1) {
          lastHeadingRef[l] = '';
          headingsAtLevel[l] = 0;
        }
        const ref = `heading:${level}#${headingsAtLevel[level]}`;
        lastHeadingRef[level] = ref;
        locator = `${headingPath(lastHeadingRef, level)}${ref}`;
        headingIndex += 1;
        confidence = 0.98;
        break;
      }
      case 'paragraph': {
        type = 'paragraph';
        // Use the shallowest active heading as the parent prefix.
        let prefix = '';
        for (let l = 1; l <= 6; l += 1) {
          const ref = lastHeadingRef[l];
          if (ref) { prefix = `${ref}/`; break; }
        }
        locator = `${prefix}paragraph:${paragraphIndex}`;
        paragraphIndex += 1;
        confidence = 0.95;
        break;
      }
      case 'list-item': {
        type = 'list-item';
        let prefix = '';
        for (let l = 1; l <= 6; l += 1) {
          const ref = lastHeadingRef[l];
          if (ref) { prefix = `${ref}/`; break; }
        }
        locator = `${prefix}list-item:${listIndex}`;
        listIndex += 1;
        confidence = clampConfidence(0.9 - ((token.level ?? 1) - 1) * 0.05);
        break;
      }
      case 'code-block': {
        type = 'code-block';
        locator = `code-block:${codeIndex}`;
        codeIndex += 1;
        confidence = 0.99;
        break;
      }
      case 'table-row': {
        type = 'table-row';
        locator = `table:${tableRowIndex}/row:${tableRowIndex}`;
        tableRowIndex += 1;
        confidence = 0.92;
        break;
      }
      case 'divider': {
        type = 'divider';
        locator = `divider:${dividerIndex}`;
        dividerIndex += 1;
        confidence = 1;
        break;
      }
    }

    return {
      id: stableBlockId(hash, locator),
      type,
      text: token.text,
      sourceRef: locator,
      confidence: clampConfidence(confidence),
    };
  });

  return {
    sourceId,
    mime: 'text/markdown',
    hash,
    retrievedAt: nowIso(),
    blocks,
    warnings: blocks.length === 0
      ? ['empty markdown produced no blocks']
      : [NO_ISSUES_WARNING],
    metadata: {
      encoding: 'utf-8',
      headingCount: headingIndex,
      paragraphCount: paragraphIndex,
      listItemCount: listIndex,
      codeBlockCount: codeIndex,
      tableRowCount: tableRowIndex,
      dividerCount: dividerIndex,
    },
  };
}
