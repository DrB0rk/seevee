
import { z } from 'zod';
import { idSchema, schemaVersionSchema, timestampSchema, extensionsSchema } from '../common/index.js';

const diagnosticItemSchema = z.object({
  id: idSchema,
  severity: z.enum(['info', 'warn', 'error', 'fatal']),
  code: z.string().min(1),
  message: z.string(),
  nodeIds: z.array(idSchema).optional(),
  page: z.number().int().min(1).optional(),
  overflowPoints: z.array(z.object({
    nodeId: idSchema,
    amount: z.number(),
    unit: z.enum(['px', 'mm', 'pt']),
  })).optional(),
  details: z.record(z.unknown()).optional(),
}).strict();

export const renderDiagnosticsDocumentSchema = z.object({
  kind: z.literal('seevee.render-diagnostics'),
  schemaVersion: schemaVersionSchema,
  id: idSchema,
  workspaceId: idSchema,
  cvRevision: z.number().int().min(0),
  presentationRevision: z.number().int().min(0),
  templateVersionId: idSchema,
  pageCount: z.number().int().min(0),
  items: z.array(diagnosticItemSchema),
  exportReady: z.boolean(),
  createdAt: timestampSchema,
  extensions: extensionsSchema.optional(),
}).strict();

export type RenderDiagnosticsDocument = z.infer<typeof renderDiagnosticsDocumentSchema>;
export type DiagnosticItem = z.infer<typeof diagnosticItemSchema>;
