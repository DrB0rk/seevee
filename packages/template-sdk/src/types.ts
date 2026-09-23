// Public types for the template SDK. Re-exports the relevant schema types
// (so consumers can import everything from a single module) and defines the
// SDK-specific read models and diagnostic types.

import { z } from 'zod';
import type {
  CvDocument,
  Section,
  CvEntity,
  PresentationDocument,
  StylePresetDocument,
  TemplateManifestDocument,
  PageProfile,
  JsonPointer,
} from '@seevee/schema';

import { fieldPathSchema } from './field-path.js';

// ─── Branded identifiers ─────────────────────────────────────────────────────

// `z.brand` gives us nominal typing on what is structurally `string`, so
// template authors cannot pass an itemId where a sectionId is expected.
export const sectionIdSchema = z.string().min(3).brand<'SectionId'>();
export const itemIdSchema = z.string().min(3).brand<'ItemId'>();

export type SectionId = z.infer<typeof sectionIdSchema>;
export type ItemId = z.infer<typeof itemIdSchema>;

// FieldPath is a thin RFC 6901-ish JSON Pointer that addresses a slot inside
// an entity. It is always normalised as a string with no leading/trailing
// whitespace and a leading slash; see field-path.ts for details.
export type FieldPath = z.infer<typeof fieldPathSchema>;
export const fieldPathBrand = fieldPathSchema;

// ─── CV read model ──────────────────────────────────────────────────────────

// A CvReadModel is the read-only view the SDK hands to templates. It carries
// the underlying CV document plus derived lookups so templates don't
// re-walk maps on every render. The constructor is internal: templates call
// `deriveCv(...)` instead of constructing directly.
export interface CvReadModel {
  readonly document: CvDocument;
  readonly sections: Readonly<Record<SectionId, CvSection>>;
  readonly items: Readonly<Record<ItemId, CvItem>>;
  readonly sectionOrder: readonly SectionId[];
}

// A CvItem is a single entity (experience, role, project, …) taken from the
// CV document's entity stores. It aliases the schema type so consumers don't
// need a separate nominal brand on top of z.infer.
export type CvItem = CvEntity;

// A CvSection is the schema's Section view — name kept to match the SDK API.
export type CvSection = Section;

// ─── Presentation read model ────────────────────────────────────────────────

export interface PresentationReadModel {
  readonly document: PresentationDocument;
  readonly template: TemplateManifestDocument;
  readonly stylePreset: StylePresetDocument | null;
  readonly pageProfile: PageProfile;
}

// ─── Diagnostics types ──────────────────────────────────────────────────────

export interface PageDiagnostic {
  readonly pageNumber: number;
  readonly overflow: boolean;
  readonly overflowAmount: number; // mm beyond content box (always >= 0)
  readonly clippedNodes: readonly ItemId[];
  readonly blankPage: boolean;
}

export interface RenderDiagnostics {
  readonly pages: readonly PageDiagnostic[];
  readonly totalOverflow: number;
  readonly hasClipping: boolean;
  readonly hasBlankPages: boolean;
  readonly fontSubstitutions: readonly string[];
  readonly missingAssets: readonly string[];
}

// ─── Page profile helper types ──────────────────────────────────────────────

// PageProfile here aliases the schema type. We export it explicitly from the
// SDK so template authors only ever import from `@seevee/template-sdk`.
export type { PageProfile };

// ─── Re-exports of commonly-needed schema types ─────────────────────────────

export type {
  CvDocument,
  CvEntity,
  Section,
  PresentationDocument,
  StylePresetDocument,
  TemplateManifestDocument,
  JsonPointer,
};
