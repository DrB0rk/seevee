/**
 * Public contract for ingestion adapters.
 *
 * Every adapter returns an `ExtractedDocument`. The result is the canonical,
 * adapter-agnostic shape that downstream stages (semantic extraction,
 * normalization, vision) consume.
 */

/** Block kinds recognised by the downstream pipeline. */
export type BlockType =
  | 'paragraph'
  | 'heading'
  | 'list-item'
  | 'table-row'
  | 'code-block'
  | 'image'
  | 'divider';

/** A single atomic unit of extracted content with stable identity. */
export interface ExtractedBlock {
  /** Stable, deterministic identifier; safe to use as a JSON key. */
  id: string;
  type: BlockType;
  /** Plain text — never markdown-encoded. */
  text: string;
  /**
   * Pointer back to the block in the source. Format is adapter-defined but
   * must be stable for a given source hash so reruns are idempotent.
   * Examples:
   *   - `paragraph:0`, `heading:1`
   *   - `section:Experience/paragraph:0`
   *   - `pdf:page=2/paragraph:0`
   */
  sourceRef: string;
  /** 0–1; adapters should report lower confidence for OCR / lossy formats. */
  confidence: number;
}

export interface ExtractedDocument {
  /** Stable identifier for this source — distinct across sources. */
  sourceId: string;
  /** MIME type for the original source bytes (e.g. `text/plain`). */
  mime: string;
  /** `sha256:<64-hex>` hash of the original bytes. */
  hash: string;
  /** ISO-8601 datetime when the source was retrieved / ingested. */
  retrievedAt: string;
  /** Set when the source was fetched from a URL. */
  url?: string;
  /** Set when the source was read from a local file. */
  fileName?: string;
  /** Ordered blocks — order carries structural meaning. */
  blocks: ExtractedBlock[];
  /** Extraction caveats. MUST contain at least one entry. */
  warnings: string[];
  /** Format-specific metadata (page count, encoding, etc.). */
  metadata: Record<string, unknown>;
}

/** Discriminated input shape every adapter accepts. */
export type SourceInput =
  | { kind: 'text'; content: string }
  | { kind: 'file'; path: string }
  | { kind: 'url'; url: string };

/** Adapter function signature. */
export type Extractor = (input: SourceInput) => Promise<ExtractedDocument>;
