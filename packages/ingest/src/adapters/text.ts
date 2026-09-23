/**
 * Plain text adapter.
 *
 * Splits the input into paragraphs, headings, list items, code blocks, and
 * dividers using deterministic line-based heuristics. Known CV section
 * headers (`Experience`, `Education`, `Skills`, `Summary`, etc.) are emitted
 * with `section:<name>/...` source refs so downstream stages can re-locate
 * a block inside a section.
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

/** Recognised CV section headers (case-insensitive lookup). */
const SECTION_HEADERS: Record<string, true> = {
  experience: true,
  'work experience': true,
  employment: true,
  'employment history': true,
  education: true,
  skills: true,
  summary: true,
  profile: true,
  'professional summary': true,
  objective: true,
  projects: true,
  certifications: true,
  certification: true,
  awards: true,
  publications: true,
  languages: true,
  interests: true,
  references: true,
  volunteering: true,
  'volunteer experience': true,
  contact: true,
  about: true,
};

function matchSectionHeader(line: string): string | null {
  const trimmed = line.trim();
  if (trimmed.length === 0) return null;
  if (trimmed.length > 60) return null;
  return SECTION_HEADERS[trimmed.toLowerCase()] === true ? trimmed.toLowerCase() : null;
}

interface Token {
  kind: 'heading' | 'paragraph' | 'list-item' | 'code-block' | 'divider';
  text: string;
}

function tokenise(content: string): Token[] {
  const lines = content.replace(/\r\n?/g, '\n').split('\n');
  const tokens: Token[] = [];
  let currentCode: string[] = [];
  let inCode = false;
  let currentSection: string | null = null;

  for (const raw of lines) {
    const line = raw.replace(/\s+$/, '');

    // Code fence toggles.
    if (/^```/.test(line)) {
      if (inCode) {
        tokens.push({ kind: 'code-block', text: currentCode.join('\n') });
        currentCode = [];
        inCode = false;
      } else {
        inCode = true;
      }
      continue;
    }
    if (inCode) {
      currentCode.push(line);
      continue;
    }

    // Horizontal divider.
    if (/^[-_*=]{3,}\s*$/.test(line)) {
      tokens.push({ kind: 'divider', text: line });
      continue;
    }

    if (line.trim().length === 0) continue;

    // Section header takes precedence (single line, looks like a heading).
    const header = matchSectionHeader(line);
    if (header !== null) {
      currentSection = header;
      tokens.push({ kind: 'heading', text: line.trim() });
      continue;
    }

    // All-caps short line (≤ 60 chars) treated as a heading.
    if (line.length <= 60 && /^[A-Z0-9][A-Z0-9 &/(),.\-]{1,59}$/.test(line)) {
      tokens.push({ kind: 'heading', text: line.trim() });
      continue;
    }

    // Markdown-style heading: `# `, `## `, etc.
    const mdMatch = /^(#{1,6})\s+(.+?)\s*#*\s*$/.exec(line);
    if (mdMatch) {
      const headingText = mdMatch[2] ?? '';
      const headerMatch = matchSectionHeader(headingText);
      if (headerMatch !== null) currentSection = headerMatch;
      tokens.push({ kind: 'heading', text: headingText });
      continue;
    }

    // List item: bullet markers (`-`, `*`, `•`) or numbered lists (`1.`, `2)`).
    const listMatch = /^\s*(?:[-*•]|\d+[.)])\s+(.+)$/.exec(line);
    if (listMatch) {
      tokens.push({ kind: 'list-item', text: (listMatch[1] ?? '').trim() });
      continue;
    }

    // Default: emit the line as its own paragraph.
    tokens.push({ kind: 'paragraph', text: line.trim() });
  }

  if (inCode && currentCode.length > 0) {
    tokens.push({ kind: 'code-block', text: currentCode.join('\n') });
  }

  // Suppress unused `currentSection` linter — the field is intentionally
  // reserved for future per-section heading tracking.
  void currentSection;

  return tokens;
}

export async function extractText(
  input: SourceInput,
): Promise<ExtractedDocument> {
  if (input.kind !== 'text') {
    throw new Error(`extractText requires { kind: 'text' }, received '${input.kind}'`);
  }
  const content = input.content;
  const hash = sha256Prefixed(content);
  const sourceId = stableSourceId('text', hash);
  const tokens = tokenise(content);

  let currentSection: string | null = null;
  let paragraphIndex = 0;
  let headingIndex = 0;
  let listIndex = 0;
  let codeIndex = 0;
  let dividerIndex = 0;

  const blocks: ExtractedBlock[] = tokens.map((token) => {
    let locator: string;
    let type: ExtractedBlock['type'];
    let confidence: number;

    switch (token.kind) {
      case 'heading': {
        const header = matchSectionHeader(token.text);
        if (header !== null) currentSection = header;
        type = 'heading';
        locator = `${currentSection !== null ? `section:${currentSection}/` : ''}heading:${headingIndex}`;
        headingIndex += 1;
        confidence = 0.95;
        break;
      }
      case 'paragraph': {
        type = 'paragraph';
        locator = `${currentSection !== null ? `section:${currentSection}/` : ''}paragraph:${paragraphIndex}`;
        paragraphIndex += 1;
        confidence = 0.9;
        break;
      }
      case 'list-item': {
        type = 'list-item';
        locator = `${currentSection !== null ? `section:${currentSection}/` : ''}list-item:${listIndex}`;
        listIndex += 1;
        confidence = 0.85;
        break;
      }
      case 'code-block': {
        type = 'code-block';
        locator = `code-block:${codeIndex}`;
        codeIndex += 1;
        confidence = 0.95;
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
    mime: 'text/plain',
    hash,
    retrievedAt: nowIso(),
    blocks,
    warnings: blocks.length === 0
      ? ['empty input produced no blocks']
      : [NO_ISSUES_WARNING],
    metadata: {
      encoding: 'utf-8',
      paragraphCount: paragraphIndex,
      headingCount: headingIndex,
      listItemCount: listIndex,
      codeBlockCount: codeIndex,
      dividerCount: dividerIndex,
    },
  };
}
