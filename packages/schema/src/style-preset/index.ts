
import { z } from 'zod';
import {
  idSchema,
  schemaVersionSchema,
  timestampSchema,
  extensionsSchema,
} from '../common/index.js';
import { tokensSchema } from '../presentation/index.js';
import { pageProfileSchema } from '../presentation/index.js';
import { sectionOverrideSchema } from '../presentation/index.js';

const stylePresetDataSchema = z.object({
  name: z.string().min(1),
  templateId: idSchema,
  templateVersionId: idSchema,
  tokens: tokensSchema,
  page: pageProfileSchema,
  sectionOverrides: z.record(idSchema, sectionOverrideSchema),
  extensions: extensionsSchema.optional(),
}).strict();

export const stylePresetDocumentSchema = z.object({
  kind: z.literal('seevee.style-preset'),
  schemaVersion: schemaVersionSchema,
  id: idSchema,
  revision: z.number().int().min(0),
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
  data: stylePresetDataSchema,
}).strict();

export type StylePresetDocument = z.infer<typeof stylePresetDocumentSchema>;
export type StylePresetData = z.infer<typeof stylePresetDataSchema>;
