/**
 * Internal helpers shared across adapters. Not part of the public API.
 */

import { createHash } from 'node:crypto';

/** Lowercase hex SHA-256 digest of `bytes`. */
export function sha256Hex(bytes: Uint8Array | string): string {
  const hash = createHash('sha256');
  hash.update(bytes);
  return hash.digest('hex');
}

/** Format digest + prefix as the canonical `sha256:<64hex>` token. */
export function sha256Prefixed(bytes: Uint8Array | string): string {
  return `sha256:${sha256Hex(bytes)}`;
}

/**
 * Build a stable, lowercase alphanumeric block id from an adapter namespace,
 * the source content hash (so ids are unique per source), and a stable
 * locator token (e.g. `paragraph:0`, `section:Experience/heading:1`).
 *
 * The resulting id always matches `^[A-Za-z][A-Za-z0-9_-]*$` so it can be
 * safely used as a key in `SourceBlock` records and round-tripped through
 * the Seevee schema.
 */
export function stableBlockId(sourceHash: string, locator: string): string {
  const seed = `${sourceHash}:${locator}`;
  const digest = sha256Hex(seed).slice(0, 24);
  // Prefix with `blk_` so ids sort cleanly in tooling and always start with
  // a letter (per `idSchema`).
  return `blk_${digest}`;
}

/** Build a stable source id from a namespace and the source content hash. */
export function stableSourceId(namespace: string, hash: string): string {
  return `src_${namespace}_${hash.slice(0, 24)}`;
}

/** Clamp `n` to the [0, 1] confidence range. */
export function clampConfidence(n: number): number {
  if (!Number.isFinite(n)) return 0;
  if (n < 0) return 0;
  if (n > 1) return 1;
  return n;
}

/** Current ISO timestamp (millisecond precision, with offset). */
export function nowIso(): string {
  return new Date().toISOString();
}

/** Cheap deterministic warning placeholder when an adapter runs cleanly. */
export const NO_ISSUES_WARNING = 'no issues';
