
import { z } from 'zod';
import { idSchema, schemaVersionSchema, timestampSchema, extensionsSchema, actorSchema } from '../common/index.js';

const checkSchema = z.object({
  id: idSchema,
  type: z.enum(['schema-valid', 'semantic-valid', 'render-success', 'no-overflow', 'no-clipping', 'template-policy', 'migration-safe', 'unresolved-comments']),
  status: z.enum(['pass', 'fail', 'warn', 'skipped']),
  message: z.string().optional(),
  details: z.record(z.unknown()).optional(),
}).strict();

const agentRunDataSchema = z.object({
  type: z.enum(['ingestion', 'cv-editor', 'design', 'comment-fix', 'qa']),
  state: z.enum(['running', 'completed', 'failed', 'cancelled']),
  inputRevisions: z.record(z.enum(['seevee.cv', 'seevee.presentation', 'seevee.comments', 'seevee.provenance', 'seevee.workspace']), z.number().int().min(0)),
  commentIds: z.array(idSchema).optional(),
  changeSetIds: z.array(idSchema).optional(),
  checks: z.array(checkSchema),
  summary: z.string(),
  startedAt: timestampSchema,
  completedAt: z.string().datetime({ offset: true }).nullable(),
  actor: actorSchema.optional(),
  extensions: extensionsSchema.optional(),
}).strict();

export const agentRunDocumentSchema = z.object({
  kind: z.literal('seevee.agent-run'),
  schemaVersion: schemaVersionSchema,
  id: idSchema,
  type: z.enum(['ingestion', 'cv-editor', 'design', 'comment-fix', 'qa']),
  state: z.enum(['running', 'completed', 'failed', 'cancelled']),
  inputRevisions: z.record(z.enum(['seevee.cv', 'seevee.presentation', 'seevee.comments', 'seevee.provenance', 'seevee.workspace']), z.number().int().min(0)),
  commentIds: z.array(idSchema),
  changeSetIds: z.array(idSchema),
  checks: z.array(checkSchema),
  summary: z.string(),
  startedAt: timestampSchema,
  completedAt: z.string().datetime({ offset: true }).nullable(),
  extensions: extensionsSchema.optional(),
}).strict();

export type AgentRunDocument = z.infer<typeof agentRunDocumentSchema>;
export type AgentRunData = z.infer<typeof agentRunDataSchema>;
export type AgentRunCheck = z.infer<typeof checkSchema>;
