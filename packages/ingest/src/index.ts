/**
 * @seevee/ingest — source extraction adapters.
 *
 * Each adapter returns an `ExtractedDocument` (see `./types.ts`). Downstream
 * stages (semantic extraction, normalization, vision) consume this shape.
 *
 * Usage:
 *   import { extractText, extractMarkdown, extractUrl } from '@seevee/ingest';
 *
 *   const doc = await extractText({ kind: 'text', content: '…' });
 *   if (doc.warnings.length > 0) console.warn(doc.warnings);
 *   for (const block of doc.blocks) console.log(block.type, block.text);
 */

export * from './types.js';
export * from './ssrf.js';
export { extractText } from './adapters/text.js';
export { extractMarkdown } from './adapters/markdown.js';
export { extractJson } from './adapters/json.js';
export { extractHtml } from './adapters/html.js';
export { extractYaml } from './adapters/yaml.js';
export { extractPdf } from './adapters/pdf.js';
export { extractDocx } from './adapters/docx.js';
export { extractUrl } from './adapters/url.js';
export { extractImage } from './adapters/image.js';
