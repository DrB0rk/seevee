
import { z } from 'zod';
import {
  idSchema,
  schemaVersionSchema,
  timestampSchema,
  extensionsSchema,
  jsonPointerSchema,
  envelopeSchema,
  actorSchema,
} from '../common/index.js';

const nodeSelectorSchema = z.object({
  type: z.literal('NodeSelector'),
  nodeId: idSchema,
  nodeType: z.string().min(1),
}).strict();

const fieldSelectorSchema = z.object({
  type: z.literal('FieldSelector'),
  nodeId: idSchema,
  nodeType: z.string().min(1),
  field: jsonPointerSchema,
}).strict();

const sectionSelectorSchema = z.object({
  type: z.literal('SectionSelector'),
  sectionId: idSchema,
}).strict();

const textQuoteSelectorSchema = z.object({
  type: z.literal('TextQuoteSelector'),
  exact: z.string().min(1),
  prefix: z.string().optional(),
  suffix: z.string().optional(),
  normalization: z.enum(['none', 'unicode-nfc', 'unicode-nfd', 'unicode-nfc-whitespace']).optional(),
}).strict();

const renderBindingSelectorSchema = z.object({
  type: z.literal('RenderBindingSelector'),
  templateVersionId: idSchema,
  bindingId: z.string().min(1),
}).strict();

const pageRegionSelectorSchema = z.object({
  type: z.literal('PageRegionSelector'),
  page: z.number().int().min(1),
  x: z.number().min(0).max(1),
  y: z.number().min(0).max(1),
  width: z.number().gt(0).max(1),
  height: z.number().gt(0).max(1),
  renderContext: z.object({
    cvRevision: z.number().int().min(0),
    presentationRevision: z.number().int().min(0),
    templateVersionId: idSchema,
  }).strict(),
}).strict();

const selectorSchema = z.discriminatedUnion('type', [
  nodeSelectorSchema,
  fieldSelectorSchema,
  sectionSelectorSchema,
  textQuoteSelectorSchema,
  renderBindingSelectorSchema,
  pageRegionSelectorSchema,
]);

const commentTargetSchema = z.object({
  source: z.object({
    resource: z.enum(['cv', 'presentation', 'template', 'provenance', 'workspace']),
    resourceId: idSchema,
    revisionAtCreation: z.number().int().min(0),
  }).strict(),
  selectors: z.array(selectorSchema).min(1),
  extensions: extensionsSchema.optional(),
}).strict();

const messageSchema = z.object({
  id: idSchema,
  author: actorSchema,
  body: z.string().min(1),
  createdAt: timestampSchema,
  supersedesMessageId: idSchema.nullable().optional(),
  extensions: extensionsSchema.optional(),
}).strict();

const agentWorkSchema = z.object({
  state: z.enum(['pending', 'claimed', 'running', 'applied', 'blocked', 'failed']),
  claimedByRunId: idSchema.nullable(),
  changeSetIds: z.array(idSchema),
}).strict();

const resolutionSchema = z.object({
  resolvedAt: timestampSchema,
  resolvedBy: actorSchema,
  note: z.string().nullable().optional(),
}).strict();

const threadSchema = z.object({
  id: idSchema,
  category: z.union([
    z.enum(['fact', 'copy', 'style', 'layout', 'template', 'page', 'accessibility', 'general']),
    z.string().regex(/^custom:[A-Za-z0-9._-]+:[A-Za-z0-9._-]+$/),
  ]),
  priority: z.enum(['low', 'normal', 'high', 'blocking']),
  status: z.enum(['open', 'in_progress', 'resolved', 'dismissed', 'superseded']),
  target: commentTargetSchema,
  messageOrder: z.array(idSchema),
  messages: z.record(idSchema, messageSchema),
  agentWork: agentWorkSchema,
  resolution: resolutionSchema.nullable(),
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
  extensions: extensionsSchema.optional(),
}).strict();

const commentsDataSchema = z.object({
  threadOrder: z.array(idSchema),
  threads: z.record(idSchema, threadSchema),
  extensions: extensionsSchema.optional(),
}).strict();

export const commentsDocumentSchema = envelopeSchema(commentsDataSchema, 'seevee.comments');
export type CommentsDocument = z.infer<typeof commentsDocumentSchema>;
export type CommentsData = z.infer<typeof commentsDataSchema>;
export type Thread = z.infer<typeof threadSchema>;
export type CommentTarget = z.infer<typeof commentTargetSchema>;
export type CommentSelector = z.infer<typeof selectorSchema>;
export type NodeSelector = z.infer<typeof nodeSelectorSchema>;
export type FieldSelector = z.infer<typeof fieldSelectorSchema>;
export type SectionSelector = z.infer<typeof sectionSelectorSchema>;
export type TextQuoteSelector = z.infer<typeof textQuoteSelectorSchema>;
export type RenderBindingSelector = z.infer<typeof renderBindingSelectorSchema>;
export type PageRegionSelector = z.infer<typeof pageRegionSelectorSchema>;
export type CommentMessage = z.infer<typeof messageSchema>;
export type AgentWork = z.infer<typeof agentWorkSchema>;
export type Resolution = z.infer<typeof resolutionSchema>;
