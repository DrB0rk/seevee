// Field value resolution for the SDK's `Field` component.
//
// This module is pure: no filesystem, no process, no network (see safety.ts).
// It exists as a standalone module so the resolution rules can be unit-tested
// without an Astro compiler in the loop.
//
// The stringification rules deliberately match `packages/renderer/src/html.ts`
// so the Astro render path and the plain-HTML render path produce byte-identical
// field text for the same CV.

import { getField } from './cv-helpers.js';
import type { CvReadModel, ItemId } from './types.js';

/**
 * Stringify a resolved field value the way the render pipeline expects:
 * scalars render as their text form, structured values render as JSON, and
 * `null`/`undefined` are reported as "no value" so the caller can substitute
 * a fallback.
 */
export function stringifyFieldValue(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  try {
    const json = JSON.stringify(value);
    return json === undefined ? null : json;
  } catch {
    // A cyclic or otherwise unserialisable value is treated as absent so a
    // template degrades to its fallback instead of crashing the render.
    return null;
  }
}

/**
 * Resolve the text a `Field` should render: the value at
 * `cv[itemId][fieldPath]`, falling back to `fallback` when the value is
 * missing or nullish.
 */
export function resolveFieldText(
  cv: CvReadModel,
  itemId: ItemId,
  fieldPath: string,
  fallback?: unknown,
): string {
  const resolved = stringifyFieldValue(getField(cv, itemId, fieldPath));
  if (resolved !== null) return resolved;
  const fallbackText = stringifyFieldValue(fallback);
  return fallbackText ?? '';
}