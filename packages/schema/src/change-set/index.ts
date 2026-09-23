
import { z } from 'zod';
import {
  idSchema,
  schemaVersionSchema,
  timestampSchema,
  extensionsSchema,
  actorSchema,
  fieldRefSchema,
  jsonPointerSchema,
} from '../common/index.js';

const resourceTargetSchema = z.object({
  resourceKind: z.enum([
    'seevee.cv',
    'seevee.presentation',
    'seevee.comments',
    'seevee.provenance',
    'seevee.workspace',
  ]),
  resourceId: z.string().min(1),
}).strict();

const changeSetReasonSchema = z.object({
  summary: z.string().min(1),
  commentIds: z.array(idSchema),
  sourceIds: z.array(idSchema).optional(),
}).strict();

const placementSchema = z.union([
  z.object({
    position: z.enum(['first', 'last']),
  }).strict(),
  z.object({
    position: z.enum(['before', 'after']),
    anchorId: idSchema,
  }).strict(),
]);

// Operations are intentionally typed as a tagged union. Each branch keeps the
// JSON Schema equivalent (the committed spec uses `true` for "any value",
// which Zod cannot enforce without losing type safety — we accept any JSON
// value for field.set / text.replace / node.add / node.patch).
const baseFieldTarget = z.object({ target: fieldRefSchema });

const fieldSetOpSchema = baseFieldTarget.extend({
  op: z.literal('field.set'),
  value: z.unknown(),
}).strict();

const fieldUnsetOpSchema = baseFieldTarget.extend({
  op: z.literal('field.unset'),
}).strict();

const textReplaceOpSchema = baseFieldTarget.extend({
  op: z.literal('text.replace'),
  expected: z.string(),
  replacement: z.string(),
}).strict();

const nodeAddOpSchema = z.object({
  op: z.literal('node.add'),
  nodeType: z.string().min(1),
  node: z.record(z.unknown()),
  sectionId: idSchema.nullable().optional(),
  placement: placementSchema,
}).strict();

const nodeRemoveOpSchema = z.object({
  op: z.literal('node.remove'),
  nodeId: idSchema,
}).strict();

const nodeMoveOpSchema = z.object({
  op: z.literal('node.move'),
  nodeId: idSchema,
  toSectionId: idSchema.optional(),
  placement: placementSchema,
}).strict();

const sectionAddOpSchema = z.object({
  op: z.literal('section.add'),
  section: z.record(z.unknown()),
  placement: placementSchema,
}).strict();

const sectionRemoveOpSchema = z.object({
  op: z.literal('section.remove'),
  sectionId: idSchema,
}).strict();

const sectionReorderOpSchema = z.object({
  op: z.literal('section.reorder'),
  sectionId: idSchema,
  placement: placementSchema,
}).strict();

const presentationTokenSetOpSchema = z.object({
  op: z.literal('presentation.token.set'),
  tokenKey: z.string().min(1),
  value: z.unknown(),
}).strict();

const presentationPageSetOpSchema = z.object({
  op: z.literal('presentation.page.set'),
  page: z.record(z.unknown()),
}).strict();

const presentationSectionOverrideOpSchema = z.object({
  op: z.literal('presentation.section.override'),
  sectionId: idSchema,
  override: z.record(z.unknown()),
}).strict();

const commentAddOpSchema = z.object({
  op: z.literal('comment.add'),
  thread: z.record(z.unknown()),
}).strict();

const commentResolveOpSchema = z.object({
  op: z.literal('comment.resolve'),
  threadId: idSchema,
  note: z.string().optional(),
}).strict();

const commentAddMessageOpSchema = z.object({
  op: z.literal('comment.addMessage'),
  threadId: idSchema,
  message: z.record(z.unknown()),
}).strict();

const operationSchema = z.discriminatedUnion('op', [
  fieldSetOpSchema,
  fieldUnsetOpSchema,
  textReplaceOpSchema,
  nodeAddOpSchema,
  nodeRemoveOpSchema,
  nodeMoveOpSchema,
  sectionAddOpSchema,
  sectionRemoveOpSchema,
  sectionReorderOpSchema,
  presentationTokenSetOpSchema,
  presentationPageSetOpSchema,
  presentationSectionOverrideOpSchema,
  commentAddOpSchema,
  commentResolveOpSchema,
  commentAddMessageOpSchema,
]);

export const changeSetDocumentSchema = z.object({
  kind: z.literal('seevee.change-set'),
  schemaVersion: schemaVersionSchema,
  id: idSchema,
  target: resourceTargetSchema,
  baseRevision: z.number().int().min(0),
  actor: actorSchema,
  reason: changeSetReasonSchema,
  operations: z.array(operationSchema).min(1),
  createdAt: timestampSchema,
  extensions: extensionsSchema.optional(),
}).strict();

export type ChangeSetDocument = z.infer<typeof changeSetDocumentSchema>;
export type ChangeSetOperation = z.infer<typeof operationSchema>;
export type ChangeSetTarget = z.infer<typeof resourceTargetSchema>;
export type ChangeSetReason = z.infer<typeof changeSetReasonSchema>;
export type Placement = z.infer<typeof placementSchema>;
