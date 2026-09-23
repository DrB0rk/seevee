
import { z } from 'zod';
import {
  idSchema,
  schemaVersionSchema,
  revisionSchema,
  timestampSchema,
  jsonPointerSchema,
  extensionsSchema,
  actorSchema,
  envelopeSchema,
} from '../common/index.js';

// data.$defs
const originSchema = z.object({
  id: idSchema,
  type: z.string().min(1),
  name: z.string().min(1),
  contentHash: z.string().regex(/^sha256:[A-Fa-f0-9]{64}$/),
  ingestedAt: timestampSchema,
  metadata: z.record(z.unknown()),
  extensions: extensionsSchema.optional(),
}).strict();

const extractionSchema = z.object({
  adaptedAt: timestampSchema,
  adapter: z.string().min(1),
  warnings: z.array(z.string()).optional(),
  language: z.string().min(2).optional(),
}).strict();

const blockSchema = z.object({
  id: idSchema,
  type: z.enum(['paragraph', 'heading', 'list', 'list-item', 'table', 'table-row', 'image', 'code', 'divider', 'unknown']),
  text: z.string().optional(),
  sourceLocators: z.array(z.object({
    start: z.number().int().min(0),
    end: z.number().int().min(0),
    sourceId: idSchema,
  })).optional(),
  children: z.array(z.object({ id: idSchema })).optional(),
  metadata: z.record(z.unknown()).optional(),
}).strict();

const sourceDataSchema = z.object({
  origin: originSchema,
  extraction: extractionSchema,
  blocks: z.record(idSchema, blockSchema),
  extensions: extensionsSchema.optional(),
}).strict();

export const sourceDocumentSchema = envelopeSchema(sourceDataSchema, 'seevee.source');
export type SourceDocument = z.infer<typeof sourceDocumentSchema>;
export type SourceData = z.infer<typeof sourceDataSchema>;
export type Origin = z.infer<typeof originSchema>;
export type Extraction = z.infer<typeof extractionSchema>;
export type SourceBlock = z.infer<typeof blockSchema>;
