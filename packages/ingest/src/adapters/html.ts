/**
 * HTML adapter.
 *
 * Tag-stripping parser that reconstructs block structure from `<h1>`–`<h6>`,
 * `<p>`, `<li>`, `<pre>`/`<code>`, `<img>`, and `<hr>`. Implementation is a
 * small, deterministic tokenizer that does not execute scripts or fetch
 * subresources; see `.dev/specs/DEVELOPMENT_PLAN.md` §14.
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

/** Tags whose inner text is treated as a top-level heading. */
const HEADING_TAGS = new Set(['h1', 'h2', 'h3', 'h4', 'h5', 'h6']);
/** Tags whose text contributes to a paragraph but should not break the
 *  surrounding flow. */
const PARENT_TAGS = new Set(['div', 'section', 'article', 'main', 'header', 'footer', 'aside']);
/** Tags whose content is dropped entirely (scripts, styles, etc.). */
const SKIP_TAGS = new Set(['script', 'style', 'noscript', 'template', 'iframe']);
/** Tags that do not require a closing tag. */
const VOID_ELEMENTS = new Set([
  'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input',
  'link', 'meta', 'param', 'source', 'track', 'wbr',
]);

interface OpenTag {
  name: string;
}

interface Token {
  kind: 'open' | 'close' | 'void' | 'text';
  name?: string;
  text: string;
}

function tokeniseHtml(content: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  let textBuffer = '';
  const flushText = (): void => {
    if (textBuffer.length === 0) return;
    tokens.push({ kind: 'text', text: textBuffer });
    textBuffer = '';
  };
  while (i < content.length) {
    const ch = content[i] ?? '';
    if (ch === '<') {
      flushText();
      const end = content.indexOf('>', i + 1);
      if (end === -1) {
        textBuffer += content.slice(i);
        break;
      }
      const raw = content.slice(i + 1, end).trim();
      i = end + 1;
      if (raw.startsWith('!--')) continue;
      if (raw.startsWith('!')) continue;
      if (raw.startsWith('?')) continue;
      const isClose = raw.startsWith('/');
      const body = isClose ? raw.slice(1).trim() : raw;
      const selfClose = body.endsWith('/');
      const tagBody = (selfClose ? body.slice(0, -1) : body).trim();
      const spaceIdx = tagBody.search(/\s/);
      const name = (spaceIdx === -1 ? tagBody : tagBody.slice(0, spaceIdx)).toLowerCase();
      if (!name) continue;
      if (isClose) {
        tokens.push({ kind: 'close', name, text: '' });
      } else if (VOID_ELEMENTS.has(name) || selfClose) {
        tokens.push({ kind: 'void', name, text: '' });
      } else {
        tokens.push({ kind: 'open', name, text: '' });
      }
      continue;
    }
    textBuffer += ch;
    i += 1;
  }
  flushText();
  return tokens;
}

function decodeEntities(text: string): string {
  return text
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#(\d+);/g, (_m, code) => {
      const n = Number(code);
      return Number.isFinite(n) ? String.fromCodePoint(n) : _m;
    });
}

function collapseWhitespace(s: string): string {
  return s.replace(/\s+/g, ' ').trim();
}

function topName(stack: ReadonlyArray<OpenTag>): string | null {
  const top = stack[stack.length - 1];
  return top?.name ?? null;
}

export async function extractHtml(
  input: SourceInput,
): Promise<ExtractedDocument> {
  if (input.kind !== 'text') {
    throw new Error(`extractHtml requires { kind: 'text' }, received '${input.kind}'`);
  }
  const content = input.content;
  const hash = sha256Prefixed(content);
  const sourceId = stableSourceId('html', hash);

  const tokens = tokeniseHtml(content);
  const blocks: ExtractedBlock[] = [];

  let skipDepth = 0;
  let headingIndex = 0;
  let paragraphIndex = 0;
  let listIndex = 0;
  let codeIndex = 0;
  let tableRowIndex = 0;
  let imageIndex = 0;
  let dividerIndex = 0;

  const stack: OpenTag[] = [];
  let buffer = '';

  const flushBufferAsParagraph = (sourceRef: string, type: ExtractedBlock['type'], confidence: number): void => {
    const text = collapseWhitespace(decodeEntities(buffer));
    buffer = '';
    if (text.length === 0) return;
    blocks.push({
      id: stableBlockId(hash, sourceRef),
      type,
      text,
      sourceRef,
      confidence: clampConfidence(confidence),
    });
  };

  const flushHeading = (): void => {
    const text = collapseWhitespace(decodeEntities(buffer));
    buffer = '';
    if (text.length === 0) return;
    blocks.push({
      id: stableBlockId(hash, `heading:${headingIndex}`),
      type: 'heading',
      text,
      sourceRef: `heading:${headingIndex}`,
      confidence: 0.95,
    });
    headingIndex += 1;
  };

  const flushListItem = (): void => {
    const text = collapseWhitespace(decodeEntities(buffer));
    buffer = '';
    if (text.length === 0) return;
    blocks.push({
      id: stableBlockId(hash, `list-item:${listIndex}`),
      type: 'list-item',
      text,
      sourceRef: `list-item:${listIndex}`,
      confidence: 0.92,
    });
    listIndex += 1;
  };

  const flushCodeBlock = (): void => {
    blocks.push({
      id: stableBlockId(hash, `code-block:${codeIndex}`),
      type: 'code-block',
      text: buffer.replace(/\n$/, ''),
      sourceRef: `code-block:${codeIndex}`,
      confidence: 0.97,
    });
    codeIndex += 1;
    buffer = '';
  };

  const flushTableRow = (): void => {
    const text = collapseWhitespace(decodeEntities(buffer));
    buffer = '';
    if (text.length === 0) return;
    blocks.push({
      id: stableBlockId(hash, `table-row:${tableRowIndex}`),
      type: 'table-row',
      text,
      sourceRef: `table-row:${tableRowIndex}`,
      confidence: 0.88,
    });
    tableRowIndex += 1;
  };

  for (const tok of tokens) {
    if (tok.kind === 'text') {
      if (skipDepth > 0) continue;
      buffer += tok.text;
      continue;
    }
    const name = tok.name ?? '';
    if (SKIP_TAGS.has(name)) {
      if (tok.kind === 'open') skipDepth += 1;
      else if (tok.kind === 'close') skipDepth = Math.max(0, skipDepth - 1);
      continue;
    }
    if (skipDepth > 0) continue;

    if (tok.kind === 'open') {
      if (HEADING_TAGS.has(name) || name === 'li' || name === 'pre' || name === 'tr' || PARENT_TAGS.has(name)) {
        if (buffer.trim().length > 0) {
          flushBufferAsParagraph(`paragraph:${paragraphIndex}`, 'paragraph', 0.85);
          paragraphIndex += 1;
        }
        stack.push({ name });
        continue;
      }
      // Inline tag (a, span, em, strong, etc.) — keep the buffer flowing.
      stack.push({ name });
      continue;
    }

    if (tok.kind === 'void') {
      if (name === 'hr') {
        if (buffer.length > 0) {
          flushBufferAsParagraph(`paragraph:${paragraphIndex}`, 'paragraph', 0.85);
          paragraphIndex += 1;
        }
        blocks.push({
          id: stableBlockId(hash, `divider:${dividerIndex}`),
          type: 'divider',
          text: '---',
          sourceRef: `divider:${dividerIndex}`,
          confidence: 1,
        });
        dividerIndex += 1;
        continue;
      }
      if (name === 'img') {
        blocks.push({
          id: stableBlockId(hash, `image:${imageIndex}`),
          type: 'image',
          text: '[image]',
          sourceRef: `image:${imageIndex}`,
          confidence: 0.6,
        });
        imageIndex += 1;
        continue;
      }
      if (name === 'br') {
        buffer += '\n';
        continue;
      }
      continue;
    }

    // close
    const top = topName(stack);
    if (top !== name) {
      // Mismatched close: drop everything down to and including the matching opener.
      const idx = stack.findIndex((t) => t.name === name);
      if (idx >= 0) stack.length = idx;
      continue;
    }
    stack.pop();

    if (HEADING_TAGS.has(name)) {
      flushHeading();
      continue;
    }
    if (name === 'li') {
      flushListItem();
      continue;
    }
    if (name === 'pre') {
      flushCodeBlock();
      continue;
    }
    if (name === 'tr') {
      flushTableRow();
      continue;
    }
    if (PARENT_TAGS.has(name)) {
      if (buffer.trim().length > 0) {
        flushBufferAsParagraph(`paragraph:${paragraphIndex}`, 'paragraph', 0.85);
        paragraphIndex += 1;
      }
      continue;
    }
    // Inline close (`</a>`, `</span>`): keep buffer intact.
  }

  if (buffer.trim().length > 0) {
    flushBufferAsParagraph(`paragraph:${paragraphIndex}`, 'paragraph', 0.85);
    paragraphIndex += 1;
  }

  return {
    sourceId,
    mime: 'text/html',
    hash,
    retrievedAt: nowIso(),
    blocks,
    warnings: blocks.length === 0
      ? ['empty or script-only HTML produced no blocks']
      : [NO_ISSUES_WARNING],
    metadata: {
      encoding: 'utf-8',
      parser: 'regex-tokenizer',
      headingCount: headingIndex,
      paragraphCount: paragraphIndex,
      listItemCount: listIndex,
      codeBlockCount: codeIndex,
      tableRowCount: tableRowIndex,
      imageCount: imageIndex,
      dividerCount: dividerIndex,
    },
  };
}
