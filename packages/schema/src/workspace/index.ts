
import { z } from 'zod';
import {
  idSchema,
  schemaVersionSchema,
  revisionSchema,
  timestampSchema,
  extensionsSchema,
  envelopeSchema,
} from '../common/index.js';

const relativePathSchema = z
  .string()
  .min(1)
  .regex(
    /^(?!\/)(?![A-Za-z]:[\\/])(?!.*(?:^|\/)..(?:\/|$)).+$/,
    'must be a relative path without parent traversal or absolute prefixes',
  );

const workspacePolicySchema = z.object({
  allowAgentFactInference: z.boolean(),
  requireEvidenceForNumericClaims: z.boolean(),
  allowForceExportWithOverflow: z.boolean(),
  autoResolveDeterministicComments: z.boolean(),
  extensions: extensionsSchema.optional(),
}).strict();

const activeSchema = z.object({
  cvId: idSchema,
  presentationId: idSchema,
  extensions: extensionsSchema.optional(),
}).strict();

const cvResourceSchema = z.object({
  id: idSchema,
  relativePath: relativePathSchema,
  revision: revisionSchema,
  updatedAt: timestampSchema,
}).strict();

const presentationResourceSchema = z.object({
  id: idSchema,
  relativePath: relativePathSchema,
  templateId: idSchema,
  versionId: idSchema,
  revision: revisionSchema,
  updatedAt: timestampSchema,
}).strict();

const fileResourceSchema = z.object({
  id: idSchema,
  relativePath: relativePathSchema,
  type: z.enum(['source', 'template-source', 'template-asset', 'export', 'change-set', 'agent-run']),
  updatedAt: timestampSchema,
}).strict();

const resourcesSchema = z.object({
  cvs: z.record(idSchema, cvResourceSchema),
  presentations: z.record(idSchema, presentationResourceSchema),
  provenance: z.record(idSchema, z.object({
    id: idSchema,
    relativePath: relativePathSchema,
    cvId: idSchema,
    revision: revisionSchema,
    updatedAt: timestampSchema,
  }).strict()),
  comments: z.record(idSchema, z.object({
    id: idSchema,
    relativePath: relativePathSchema,
    cvId: idSchema,
    revision: revisionSchema,
    updatedAt: timestampSchema,
  }).strict()),
  sources: z.record(idSchema, fileResourceSchema),
  templates: z.record(idSchema, z.object({
    id: idSchema,
    relativePath: relativePathSchema,
    currentVersionId: idSchema,
    updatedAt: timestampSchema,
  }).strict()),
  stylePresets: z.record(idSchema, fileResourceSchema),
  changeSets: z.record(idSchema, fileResourceSchema),
  agentRuns: z.record(idSchema, fileResourceSchema),
}).strict();

const workspaceDataSchema = z.object({
  name: z.string().min(1),
  active: activeSchema,
  resources: resourcesSchema,
  policy: workspacePolicySchema,
  extensions: extensionsSchema.optional(),
}).strict();

export const workspaceDocumentSchema = envelopeSchema(workspaceDataSchema, 'seevee.workspace');
export type WorkspaceDocument = z.infer<typeof workspaceDocumentSchema>;
export type WorkspaceData = z.infer<typeof workspaceDataSchema>;
export type WorkspacePolicy = z.infer<typeof workspacePolicySchema>;
export type ActiveSelection = z.infer<typeof activeSchema>;
export type CvResource = z.infer<typeof cvResourceSchema>;
export type PresentationResource = z.infer<typeof presentationResourceSchema>;
export type FileResource = z.infer<typeof fileResourceSchema>;
export type Resources = z.infer<typeof resourcesSchema>;
