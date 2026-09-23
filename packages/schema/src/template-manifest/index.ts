
import { z } from 'zod';
import {
  idSchema,
  schemaVersionSchema,
  extensionsSchema,
} from '../common/index.js';

const capabilitiesSchema = z.object({
  multiPage: z.boolean(),
  customPageSize: z.boolean(),
  comments: z.boolean(),
  twoColumn: z.boolean(),
  accessiblePdf: z.boolean().optional(),
}).strict();

const tokenDefinitionSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('number'),
    default: z.number(),
    min: z.number().optional(),
    max: z.number().optional(),
    step: z.number().positive().optional(),
    dashboardEditable: z.boolean(),
    affectsPagination: z.boolean().optional(),
  }).strict(),
  z.object({
    type: z.literal('color'),
    default: z.string(),
    dashboardEditable: z.boolean(),
    affectsPagination: z.boolean().optional(),
  }).strict(),
  z.object({
    type: z.literal('boolean'),
    default: z.boolean(),
    dashboardEditable: z.boolean(),
    affectsPagination: z.boolean().optional(),
  }).strict(),
  z.object({
    type: z.literal('enum'),
    default: z.string(),
    options: z.array(z.string()).min(1),
    dashboardEditable: z.boolean(),
    affectsPagination: z.boolean().optional(),
  }).strict(),
  z.object({
    type: z.literal('string'),
    default: z.string(),
    dashboardEditable: z.boolean(),
    affectsPagination: z.boolean().optional(),
  }).strict(),
]);

const bindingSchema = z.object({
  id: z.string().min(1),
  selector: z.string().min(1),
  kind: z.enum(['field', 'node', 'section', 'collection', 'custom']),
  defaultToken: z.string().optional(),
  description: z.string().optional(),
}).strict();

const designIntentSchema = z.object({
  sector: z.string().optional(),
  voice: z.enum(['academic', 'corporate', 'creative', 'technical', 'executive', 'minimal', 'custom']).optional(),
  constraints: z.array(z.string()).optional(),
}).strict();

export const templateManifestDocumentSchema = z.object({
  kind: z.literal('seevee.template-manifest'),
  schemaVersion: schemaVersionSchema,
  id: idSchema,
  templateId: idSchema,
  name: z.string().min(1),
  version: schemaVersionSchema,
  entry: z.string().min(1),
  engine: z.literal('astro'),
  capabilities: capabilitiesSchema,
  supportedCvSchema: z.string().regex(/^[0-9]+\.[0-9]+\.[0-9]+$/),
  supportedPresentationSchema: z.string().regex(/^[0-9]+\.[0-9]+\.[0-9]+$/),
  tokens: z.record(z.string().min(1), tokenDefinitionSchema),
  bindings: z.record(z.string().min(1), bindingSchema),
  extensions: extensionsSchema.optional(),
  designIntent: designIntentSchema.optional(),
}).strict();

export type TemplateManifestDocument = z.infer<typeof templateManifestDocumentSchema>;
export type TemplateCapabilities = z.infer<typeof capabilitiesSchema>;
export type TokenDefinition = z.infer<typeof tokenDefinitionSchema>;
export type Binding = z.infer<typeof bindingSchema>;
export type DesignIntent = z.infer<typeof designIntentSchema>;
