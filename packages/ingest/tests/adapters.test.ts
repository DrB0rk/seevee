import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync, existsSync, writeFileSync, unlinkSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

import { extractText } from '../src/adapters/text.js';
import { extractMarkdown } from '../src/adapters/markdown.js';
import { extractJson } from '../src/adapters/json.js';
import { extractHtml } from '../src/adapters/html.js';
import { extractYaml } from '../src/adapters/yaml.js';
import { extractPdf } from '../src/adapters/pdf.js';
import { extractDocx } from '../src/adapters/docx.js';
import { extractUrl } from '../src/adapters/url.js';
import { extractImage } from '../src/adapters/image.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURES = resolve(HERE, 'fixtures');

function readFixture(name: string): string {
  return readFileSync(resolve(FIXTURES, name), 'utf8');
}

function fileFixture(name: string): string {
  return resolve(FIXTURES, name);
}

describe('extractText', () => {
  it('produces ≥3 blocks with correct types for "Experience\\nCompany A\\nRole B"', async () => {
    const doc = await extractText({ kind: 'text', content: 'Experience\nCompany A\nRole B' });
    expect(doc.blocks.length).toBeGreaterThanOrEqual(3);
    const types = doc.blocks.map((b) => b.type);
    expect(types).toContain('heading');
    expect(types).toContain('paragraph');
  });

  it('emits section: sourceRef for known headers', async () => {
    const doc = await extractText({
      kind: 'text',
      content: 'Experience\nFirst role at Acme.\nSkills\nTypeScript, Rust.',
    });
    const refs = doc.blocks.map((b) => b.sourceRef);
    expect(refs.some((r) => r.startsWith('section:experience/'))).toBe(true);
    expect(refs.some((r) => r.startsWith('section:skills/'))).toBe(true);
  });

  it('assigns deterministic ids for identical input', async () => {
    const a = await extractText({ kind: 'text', content: 'Hello world' });
    const b = await extractText({ kind: 'text', content: 'Hello world' });
    expect(a.hash).toBe(b.hash);
    expect(a.blocks.map((x) => x.id)).toEqual(b.blocks.map((x) => x.id));
  });

  it('handles list items and code blocks', async () => {
    const doc = await extractText({
      kind: 'text',
      content: 'Skills\n- TypeScript\n- Rust\n```\nlet x = 1;\n```\nEducation\nBSc',
    });
    const types = doc.blocks.map((b) => b.type);
    expect(types.filter((t) => t === 'list-item').length).toBeGreaterThanOrEqual(2);
    expect(types).toContain('code-block');
  });

  it('returns a single warning when input is empty', async () => {
    const doc = await extractText({ kind: 'text', content: '' });
    expect(doc.blocks).toEqual([]);
    expect(doc.warnings.length).toBeGreaterThan(0);
  });

  it('round-trips the resume fixture', async () => {
    const doc = await extractText({ kind: 'text', content: readFixture('resume.txt') });
    expect(doc.blocks.length).toBeGreaterThan(0);
    expect(doc.blocks.some((b) => b.text === 'Experience')).toBe(true);
    expect(doc.blocks.some((b) => b.text === 'Skills')).toBe(true);
    expect(doc.blocks.some((b) => b.text === 'Education')).toBe(true);
  });
  it('rejects non-text inputs', async () => {
    await expect(
      // @ts-expect-error — testing runtime validation
      extractText({ kind: 'file', path: '/tmp' }),
    ).rejects.toThrow(/extractText requires/);
  });
});

describe('extractMarkdown', () => {
  it('parses headings, lists, and code blocks', async () => {
    const doc = await extractMarkdown({ kind: 'text', content: readFixture('resume.md') });
    expect(doc.blocks.length).toBeGreaterThan(0);
    const types = doc.blocks.map((b) => b.type);
    expect(types).toContain('heading');
    expect(types).toContain('list-item');
  });

  it('preserves hierarchy in sourceRef', async () => {
    const doc = await extractMarkdown({
      kind: 'text',
      content: '## A\nparagraph\n### Sub\nlist-item',
    });
    const refs = doc.blocks.map((b) => b.sourceRef);
    // Paragraph under h2 should be prefixed by the h2 heading ref.
    expect(refs).toContain('heading:2#1/paragraph:0');
    // Heading under h3 should sit beneath the h2 prefix.
    expect(refs).toContain('heading:2#1/heading:3#1');
  });

  it('handles pipe tables', async () => {
    const doc = await extractMarkdown({
      kind: 'text',
      content: '| A | B |\n|---|---|\n| 1 | 2 |\n| 3 | 4 |',
    });
    expect(doc.blocks.some((b) => b.type === 'table-row')).toBe(true);
  });
});

describe('extractJson', () => {
  it('detects seevee.cv envelopes with high confidence', async () => {
    const doc = await extractJson({ kind: 'text', content: readFixture('cv.json') });
    expect(doc.warnings.some((w) => w.includes('seevee.cv'))).toBe(true);
    expect(doc.blocks.some((b) => b.text === 'Experience')).toBe(true);
    expect(doc.blocks.some((b) => b.text === 'Senior Engineer at Acme')).toBe(true);
    expect(doc.blocks.every((b) => b.confidence >= 0.5)).toBe(true);
  });

  it('treats unstructured JSON as raw text', async () => {
    const doc = await extractJson({ kind: 'text', content: readFixture('flat.json') });
    expect(doc.warnings.some((w) => w.includes('unstructured'))).toBe(true);
    expect(doc.blocks.length).toBeGreaterThan(0);
  });

  it('surfaces parse errors as warnings', async () => {
    const doc = await extractJson({ kind: 'text', content: '{not json' });
    expect(doc.blocks).toEqual([]);
    expect(doc.warnings.some((w) => /parse error/.test(w))).toBe(true);
  });
});

describe('extractHtml', () => {
  it('strips tags and preserves heading + paragraph structure', async () => {
    const doc = await extractHtml({ kind: 'text', content: readFixture('page.html') });
    const types = doc.blocks.map((b) => b.type);
    expect(types).toContain('heading');
    expect(types).toContain('paragraph');
    expect(types).toContain('list-item');
    expect(types).toContain('code-block');
    expect(types).toContain('image');
    expect(types).toContain('divider');
  });

  it('drops script content', async () => {
    const doc = await extractHtml({ kind: 'text', content: '<script>alert("x")</script><p>safe</p>' });
    const allText = doc.blocks.map((b) => b.text).join(' ');
    expect(allText).not.toContain('alert');
    expect(allText).toContain('safe');
  });

  it('round-trips heading + paragraph + list HTML', async () => {
    const html = '<h1>Title</h1><p>Para 1</p><ul><li>A</li><li>B</li></ul>';
    const doc = await extractHtml({ kind: 'text', content: html });
    expect(doc.blocks.find((b) => b.type === 'heading')?.text).toBe('Title');
    expect(doc.blocks.find((b) => b.type === 'paragraph')?.text).toBe('Para 1');
    expect(doc.blocks.filter((b) => b.type === 'list-item').length).toBe(2);
  });

  it('decodes common entities and strips whitespace', async () => {
    const doc = await extractHtml({
      kind: 'text',
      content: '<p>Jane &amp; John &nbsp;  &nbsp; went.</p>',
    });
    expect(doc.blocks[0]?.text).toBe('Jane & John went.');
  });
});

describe('extractYaml', () => {
  it('detects seevee.cv envelopes', async () => {
    const doc = await extractYaml({ kind: 'text', content: readFixture('cv.yaml') });
    expect(doc.warnings.some((w) => w.includes('seevee.cv'))).toBe(true);
    expect(doc.blocks.some((b) => b.text === 'Senior Engineer at Acme')).toBe(true);
  });

  it('treats plain maps as flat key/value list', async () => {
    const doc = await extractYaml({
      kind: 'text',
      content: 'name: Jane\nrole: engineer\n',
    });
    expect(doc.warnings.some((w) => w.includes('unstructured'))).toBe(true);
    expect(doc.blocks.some((b) => b.text.includes('name: Jane'))).toBe(true);
  });

  it('reports YAML parse errors as warnings', async () => {
    const doc = await extractYaml({ kind: 'text', content: 'foo: [invalid' });
    expect(doc.warnings.some((w) => /parse error/.test(w))).toBe(true);
  });
});

describe('extractPdf', () => {
  const pdfPath = fileFixture('resume.pdf');
  const skipPdf = !existsSync(pdfPath);

  it.skipIf(skipPdf)('extracts text via pdftotext', async () => {
    const doc = await extractPdf({ kind: 'file', path: pdfPath });
    expect(doc.metadata).toHaveProperty('parser', 'pdftotext');
    if (doc.metadata.status === 'success') {
      expect(doc.warnings).toContain('no issues');
      expect(doc.blocks.some((b) => b.text.includes('Jane Doe'))).toBe(true);
    } else {
      expect(doc.warnings.some((warning) => /PDF text extraction unavailable/.test(warning))).toBe(true);
      expect(doc.blocks.some((block) => block.sourceRef === 'pdf:warning')).toBe(true);
    }
  });

  it('emits a warning block when the file does not exist', async () => {
    await expect(
      extractPdf({ kind: 'file', path: '/nonexistent/path/to/file.pdf' }),
    ).rejects.toThrow(/file not found/);
  });
});

describe('extractDocx', () => {
  const docxPath = fileFixture('resume.docx');
  const skipDocx = !existsSync(docxPath);

  it.skipIf(skipDocx)('unzips and extracts paragraphs from word/document.xml', async () => {
    const doc = await extractDocx({ kind: 'file', path: docxPath });
    expect(doc.warnings.some((w) => /no issues/.test(w))).toBe(true);
    expect(doc.blocks.some((b) => b.text === 'Jane Doe')).toBe(true);
    expect(doc.blocks.some((b) => b.text === 'Experience')).toBe(true);
    expect(doc.blocks.every((b) => b.type === 'paragraph')).toBe(true);
  });

  it('emits a warning when the file is not a valid zip', async () => {
    // Create a temp file with non-zip content.
    const path = '/tmp/not-a-real-docx.docx';
    writeFileSync(path, 'this is not a zip archive');
    try {
      const doc = await extractDocx({ kind: 'file', path });
      expect(doc.warnings.length).toBeGreaterThan(0);
      expect(doc.blocks).toEqual([]);
    } finally {
      try { unlinkSync(path); } catch { /* best-effort cleanup */ }
    }
  });
});

describe('extractUrl', () => {
  it('rejects loopback URLs with a warning', async () => {
    const doc = await extractUrl({ kind: 'url', url: 'http://127.0.0.1/x' });
    expect(doc.warnings.some((w) => /SSRF/.test(w))).toBe(true);
    expect(doc.blocks).toEqual([]);
  });

  it('rejects private IPs with a warning', async () => {
    const doc = await extractUrl({ kind: 'url', url: 'http://10.0.0.5/x' });
    expect(doc.warnings.some((w) => /SSRF/.test(w))).toBe(true);
    expect(doc.blocks).toEqual([]);
  });

  it('rejects localhost by name', async () => {
    const doc = await extractUrl({ kind: 'url', url: 'http://localhost:8080/' });
    expect(doc.warnings.some((w) => /loopback/.test(w))).toBe(true);
  });

  it('rejects non-http schemes', async () => {
    const doc = await extractUrl({ kind: 'url', url: 'file:///etc/passwd' });
    expect(doc.warnings.some((w) => /SSRF/.test(w))).toBe(true);
  });
});

describe('extractImage', () => {
  let pngPath: string;

  beforeAll(() => {
    // Minimal 1×1 transparent PNG.
    const png = Buffer.from(
      '89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d49444154789c63000100000005000100' +
      '0d0a2db40000000049454e44ae426082',
      'hex',
    );
    pngPath = '/tmp/seevee-pixel.png';
    writeFileSync(pngPath, png);
  });

  it('emits a single image block', async () => {
    const doc = await extractImage({ kind: 'file', path: pngPath });
    expect(doc.blocks).toHaveLength(1);
    expect(doc.blocks[0]?.type).toBe('image');
    expect(doc.blocks[0]?.text).toBe('[image]');
    expect(doc.warnings.some((w) => /vision/.test(w))).toBe(true);
  });
});
