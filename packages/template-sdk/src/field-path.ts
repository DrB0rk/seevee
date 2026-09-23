// Field path helpers: turn a JSON-Pointer-like string (e.g. `/role/title`)
// into a normalised segment array and back. Templates use these to render
// `data-seevee-field-path` anchors and to fetch nested fields via getField.

import { z } from 'zod';

const trimmedPointerSchema = z
  .string()
  .regex(/^(?:\/(?:[^~/]|~0|~1)*)+$/, 'must be a non-empty JSON Pointer (RFC 6901)');

const MAX_DEPTH = 16;

export const fieldPathSchema = z
  .string()
  .min(1)
  .max(512)
  .transform((value, ctx) => {
    const trimmed = value.trim();
    const parsed = trimmedPointerSchema.safeParse(trimmed);
    if (!parsed.success) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'field path must start with "/" and use JSON Pointer segments',
      });
      return z.NEVER;
    }
    return parsed.data;
  })
  .brand<'FieldPath'>();

/**
 * Parse a JSON-Pointer-like path string into its normalised segments.
 *
 * The input is trimmed and may optionally start with a `/`. Empty segments
 * (`//`), `~` not followed by `0`/`1`, and embedded slashes inside a segment
 * are rejected. Segments honour the same RFC 6901 escapes the rest of
 * Seevee uses: `~1` → `/`, `~0` → `~`.
 *
 * Examples:
 *   parseFieldPath('  /role/title ')  → ['role', 'title']
 *   parseFieldPath('/a~1b/c~0d')      → ['a/b', 'c~d']
 *   parseFieldPath('')                → throws
 */
export function parseFieldPath(input: string): readonly string[] {
  const trimmed = input.trim();
  if (trimmed.length === 0) {
    throw new Error('field path cannot be empty');
  }
  const match = trimmed.match(/^\/(.+)$/);
  if (match === null) {
    throw new Error('field path must start with "/"');
  }
  const raw = match[1] as string;
  const segments = raw.split('/');
  if (segments.length > MAX_DEPTH) {
    throw new Error(`field path exceeds max depth of ${MAX_DEPTH}`);
  }
  const decoded: string[] = [];
  for (const segment of segments) {
    if (segment.length === 0) {
      throw new Error('field path segments cannot be empty');
    }
    if (!/^(?:[^~/]|~0|~1)*$/.test(segment)) {
      throw new Error('field path segments must not contain literal "/" or "~" except as ~0/~1');
    }
    decoded.push(segment.replace(/~1/g, '/').replace(/~0/g, '~'));
  }
  return decoded;
}

/**
 * Format a list of segments back into a normalised field path string. The
 * result is always lowercase-`~0`/`~1` escaped and prefixed with a single `/`;
 * `parseFieldPath(formatFieldPath(segments))` yields the same segments.
 */
export function formatFieldPath(segments: readonly string[]): string {
  if (segments.length === 0) {
    throw new Error('field path must have at least one segment');
  }
  const encoded: string[] = [];
  for (const segment of segments) {
    if (segment.length === 0) {
      throw new Error('field path segments cannot be empty');
    }
    encoded.push(segment.replace(/~/g, '~0').replace(/\//g, '~1'));
  }
  return `/${encoded.join('/')}`;
}
