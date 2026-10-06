// Public entry point for `@seevee/template-sdk`. Templates import from this
// module only; everything else is an internal file path kept out of the
// `exports` map in package.json.
//
// The exports are deliberately explicit rather than `export *`: we want
// every published symbol to be a deliberate decision and we want the
// surface readable as a list of contract terms.
//
// IMPORTANT — the four structural components (`Page`, `Section`, `Item`,
// `Field`) are deliberately NOT re-exported here. They are `.astro` files,
// so importing them requires a toolchain that can compile Astro; this entry
// point stays importable by plain Node consumers (renderer, template-
// compiler, export, cli) that only need the read model and diagnostics.
// Templates get them from `@seevee/template-sdk/components`.
//
// The zero-cost value export is `components`, an object whose properties are
// loaded through a getter, so merely importing this module never pulls an
// `.astro` file into the consumer's module graph.

import { assertSafeSdk } from './safety.js';
import { bind } from './bindings.js';
import { getField, getItem, getSection, deriveCv } from './cv-helpers.js';
import {
  evaluatePageLayout,
  aggregateDiagnostics,
  contentBoxMm,
  hasOverflow,
} from './diagnostics.js';
import {
  parseFieldPath,
  formatFieldPath,
} from './field-path.js';
import {
  resolveFieldText,
  stringifyFieldValue,
} from './field-text.js';

// ─── Types ──────────────────────────────────────────────────────────────────

export type {
  CvReadModel,
  CvSection,
  CvItem,
  SectionId,
  ItemId,
  FieldPath,
  PresentationReadModel,
  PageDiagnostic,
  RenderDiagnostics,
  PageProfile,
} from './types.js';

// Schema re-exports — templates shouldn't have to reach into @seevee/schema
// directly. Each symbol here is intentionally curated; missing entry is not
// an oversight.
//
// Note: the schema's `Section` type is intentionally NOT re-exported under
// its own name because the public surface exports a `Section` component
// factory. Use `CvSection` for the schema type alias defined in types.ts.
export type {
  CvDocument,
  CvEntity,
  PresentationDocument,
  StylePresetDocument,
  TemplateManifestDocument,
  PageProfile as SchemaPageProfile,
} from '@seevee/schema';

// ─── Functions ─────────────────────────────────────────────────────────────

export {
  // CV helpers
  deriveCv,
  getSection,
  getItem,
  getField,
  // Semantic bindings
  bind,
  // Layout diagnostics
  evaluatePageLayout,
  aggregateDiagnostics,
  contentBoxMm,
  hasOverflow,
  // Field path helpers
  parseFieldPath,
  formatFieldPath,
  // Field value resolution (used by the Field component)
  resolveFieldText,
  stringifyFieldValue,
};

// ─── Structural components ──────────────────────────────────────────────────

/**
 * Prop contracts for the four structural components. These are plain types,
 * always available from this entry point.
 *
 * The component values themselves live at
 * `@seevee/template-sdk/components` — see the note at the top of this file
 * for why they are not exported here.
 */
export type {
  PageProps,
  SectionProps,
  ItemProps,
  FieldProps,
} from './page-helpers.js';

// ─── Safety ─────────────────────────────────────────────────────────────────

export {
  assertSafeSdk,
  isUnsafeImport,
  REJECTED_NODE_BUILTINS,
  REJECTED_GLOBALS,
} from './safety.js';

// Run the safety assertion on every import so a violation surfaces at the
// template's first interaction with the SDK, not deep inside a render.
assertSafeSdk();
