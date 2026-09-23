# `@seevee/ingest`

Source-extraction adapters for the Seevee pipeline. Each adapter takes a
`SourceInput` (text, file, or URL) and returns a deterministic
`ExtractedDocument` consumed by the semantic extraction and normalization
stages downstream.

See `.dev/specs/DEVELOPMENT_PLAN.md` §6 for the high-level contract and
`.dev/specs/SCHEMA_ARCHITECTURE.md` for the canonical data model.

## Adapter contract

Every adapter exports a single async function with the signature:

```ts
extract*(input: SourceInput): Promise<ExtractedDocument>;
```

`SourceInput` is a discriminated union:

```ts
type SourceInput =
  | { kind: 'text'; content: string }
  | { kind: 'file'; path: string }
  | { kind: 'url';  url: string };
```

The returned `ExtractedDocument` carries:

- `sourceId` — stable id, derived from the source hash + adapter namespace.
- `mime` — e.g. `text/plain`, `application/pdf`.
- `hash` — `sha256:<64-hex>` of the original bytes (or URL when only the URL
  is known).
- `retrievedAt` — ISO-8601 datetime.
- `url?`, `fileName?` — provenance hints.
- `blocks: ExtractedBlock[]` — ordered, stable-id blocks.
- `warnings: string[]` — extraction caveats. NEVER empty: adapters emit
  `"no issues"` when extraction succeeded without flagging anything.
- `metadata: Record<string, unknown>` — format-specific (page count,
  encoding, parser, etc.).

Each `ExtractedBlock` carries:

- `id` — stable, deterministic, `blk_<24-hex>`. Matches
  `^[A-Za-z][A-Za-z0-9_-]*$` so it can be used as a `SourceBlock` key.
- `type` — one of `'paragraph' | 'heading' | 'list-item' | 'table-row' | 'code-block' | 'image' | 'divider'`.
- `text` — plain text, never markdown-encoded.
- `sourceRef` — adapter-defined pointer (e.g. `paragraph:0`,
  `section:Experience/paragraph:0`, `pdf:page=2/paragraph:0`).
- `confidence` — 0..1 extraction confidence.

## Adapters

| Adapter            | Input              | Strategy                                                                  |
| ------------------ | ------------------ | ------------------------------------------------------------------------- |
| `extractText`      | `{ kind: 'text' }` | Line-driven; detects known CV section headers (`Experience`, `Education`, `Skills`, …) and emits `section:<name>/...` sourceRefs. |
| `extractMarkdown`  | `{ kind: 'text' }` | ATX headings, ordered/unordered lists, fenced code, pipe tables. Preserves heading hierarchy in sourceRef. |
| `extractJson`      | `{ kind: 'text' }` | Detects `kind: seevee.cv` envelopes and emits structured blocks with high confidence. Otherwise flattens to text. |
| `extractHtml`      | `{ kind: 'text' }` | Regex-based tokenizer that strips tags, decodes entities, and reconstructs `<h1>`–`<h6>`, `<p>`, `<li>`, `<pre>`, `<hr>`, `<img>` structure. |
| `extractYaml`      | `{ kind: 'text' }` | Same CV detection as JSON, falls back to a flat key/value rendering. Uses `js-yaml`. |
| `extractPdf`       | `{ kind: 'file' }` | Spawns `pdftotext -layout -q` (poppler). Falls back to a warning block if the binary is missing, the file is unreadable, or extraction times out. |
| `extractDocx`      | `{ kind: 'file' }` | Zero-dependency ZIP reader using the native `DecompressionStream('deflate-raw')`. Extracts `<w:p>` text from `word/document.xml`. |
| `extractUrl`       | `{ kind: 'url' }`  | Fetches with a 10-second `AbortController` timeout, validates destination via the SSRF policy, routes to `extractHtml` or `extractText` based on `Content-Type`. |
| `extractImage`     | `{ kind: 'file' }` | Stub: emits a single `[image]` block. Vision-model extraction is deferred to a later pipeline stage. |

## SSRF policy

`extractUrl` rejects destinations that resolve to private networks before
issuing any fetch. See `src/ssrf.ts` for the full surface.

The static rules reject:

- `127.0.0.0/8`, `10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`
- `169.254.0.0/16` (link-local), `224.0.0.0/4` (multicast), `240.0.0.0/4` (reserved), `0.0.0.0/8`
- IPv6 loopback (`::1`), unspecified (`::`), link-local (`fe80::/10`),
  site-local (`fec0::/10`), ULA (`fc00::/7`), and IPv4-mapped private
  addresses.
- Any host matching `localhost`, `*.localhost`, `*.local`.
- Any non-`http(s)` scheme (`file:`, `ftp:`, `javascript:`, …).

For hostnames (not literals) the adapter also performs a DNS lookup and
fails closed if ANY resolved address is private.

On rejection the adapter returns:

```json
{
  "blocks": [],
  "warnings": ["URL rejected by SSRF policy: private IP literal \"10.0.0.5\""],
  "metadata": { "status": "ssrf-rejected" }
}
```

## Usage

```ts
import {
  extractText,
  extractMarkdown,
  extractUrl,
  isPrivateUrl,
  assertUrlSafe,
} from '@seevee/ingest';

// Plain text
const doc = await extractText({ kind: 'text', content: 'Experience\nAcme 2021-2024' });

// URL with SSRF check
if (isPrivateUrl('http://example.com/')) throw new Error('blocked');
const urlDoc = await extractUrl({ kind: 'url', url: 'https://example.com/cv' });
```

## Scripts

| Command                  | Purpose                                          |
| ------------------------ | ------------------------------------------------ |
| `pnpm typecheck`         | Strict `tsc --noEmit` check.                     |
| `pnpm test`              | Run the vitest suite (`ssrf.test.ts`, `adapters.test.ts`). |
| `pnpm build`             | Emit `dist/` for downstream consumers.          |
| `pnpm clean`             | Remove `dist/` and tsbuildinfo.                  |

## External tools

- `pdftotext` (from poppler-utils) is required by `extractPdf`. The
  adapter gracefully degrades when the binary is missing.

## Scope

This package is **adapters only**. It does not perform LLM/vision
extraction, semantic normalization, or template rendering. Those live in
upstream / downstream stages of the Seevee pipeline.
