
import { z } from 'zod';
import {
  idSchema,
  schemaVersionSchema,
  extensionsSchema,
  envelopeSchema,
} from '../common/index.js';

const templateSelectionSchema = z.object({
  templateId: idSchema,
  versionId: idSchema,
  stylePresetId: idSchema.nullable().optional(),
}).strict();

const edgesSchema = z.object({
  top: z.number().min(0),
  right: z.number().min(0),
  bottom: z.number().min(0),
  left: z.number().min(0),
}).strict();

const paginationSchema = z.object({
  targetMin: z.number().int().min(1).optional(),
  targetMax: z.number().int().min(1).optional(),
  breakBehavior: z.enum(['avoid', 'split', 'page-before', 'page-after', 'auto']).optional(),
}).strict();

const tokenValueSchema = z.union([
  z.object({ type: z.literal('number'), value: z.number() }),
  z.object({ type: z.literal('color'), value: z.string().regex(/^#[0-9A-Fa-f]{6}([0-9A-Fa-f]{2})?$/) }),
  z.object({ type: z.literal('string'), value: z.string() }),
  z.object({ type: z.literal('boolean'), value: z.boolean() }),
]);

const tokensSchema = z.record(z.string().min(1), tokenValueSchema);

const sectionOverrideSchema = z.object({
  visible: z.boolean().optional(),
  order: z.number().int().optional(),
  tokens: tokensSchema.optional(),
}).strict();

const pageProfileSchema = z.object({
  preset: z.enum(['A4', 'Letter', 'Legal', 'custom']),
  orientation: z.enum(['portrait', 'landscape']),
  width: z.number().positive().optional(), // mm
  height: z.number().positive().optional(), // mm
  scale: z.number().min(0.1).max(4).optional(),
  edges: edgesSchema.optional(),
}).strict();

const presentationDataSchema = z.object({
  cvId: idSchema,
  template: templateSelectionSchema,
  page: pageProfileSchema,
  pagination: paginationSchema,
  tokens: tokensSchema,
  sectionOverrides: z.record(idSchema, sectionOverrideSchema),
  templateOverrides: z.record(z.string(), z.unknown()),
  extensions: extensionsSchema.optional(),
}).strict();

export const presentationDocumentSchema = envelopeSchema(presentationDataSchema, 'seevee.presentation');
export type PresentationDocument = z.infer<typeof presentationDocumentSchema>;
export { tokenValueSchema, tokensSchema, sectionOverrideSchema, pageProfileSchema };
export type PresentationData = z.infer<typeof presentationDataSchema>;
export type TemplateSelection = z.infer<typeof templateSelectionSchema>;
export type PageProfile = z.infer<typeof pageProfileSchema>;
export type PageEdges = z.infer<typeof edgesSchema>;
export type Pagination = z.infer<typeof paginationSchema>;
export type Tokens = z.infer<typeof tokensSchema>;
export type TokenValue = z.infer<typeof tokenValueSchema>;
export type SectionOverride = z.infer<typeof sectionOverrideSchema>;
