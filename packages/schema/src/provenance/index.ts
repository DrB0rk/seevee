
import { z } from 'zod';
import {
  idSchema,
  schemaVersionSchema,
  timestampSchema,
  extensionsSchema,
  envelopeSchema,
  semanticRefSchema,
} from '../common/index.js';

const sourceSchema = z.object({
  id: idSchema,
  sourceType: z.string().min(1),
  name: z.string().min(1),
  contentHash: z.string().regex(/^sha256:[A-Fa-f0-9]{64}$/),
  ingestedAt: timestampSchema,
  metadata: z.record(z.unknown()),
  extensions: extensionsSchema.optional(),
}).strict();

const evidenceSchema = z.object({
  locators: z.array(z.object({
    type: z.enum(['page', 'page-text', 'text-range', 'xpath', 'css-selector']),
    page: z.number().int().min(1).optional(),
    quote: z.string().optional(),
    start: z.number().int().min(0).optional(),
    end: z.number().int().min(0).optional(),
    xpath: z.string().optional(),
    cssSelector: z.string().optional(),
  })),
  note: z.string().optional(),
}).strict();

const assertionSchema = z.object({
  id: idSchema,
  target: semanticRefSchema,
  evidence: z.array(evidenceSchema),
  claimType: z.enum(['direct', 'inferred', 'summarized']),
  confidence: z.enum(['high', 'medium', 'low']),
  verifiedByUser: z.boolean(),
  extensions: extensionsSchema.optional(),
}).strict();

const provenanceDataSchema = z.object({
  sources: z.record(idSchema, sourceSchema),
  assertions: z.record(idSchema, assertionSchema),
  extensions: extensionsSchema.optional(),
}).strict();

export const provenanceDocumentSchema = envelopeSchema(provenanceDataSchema, 'seevee.provenance');
export type ProvenanceDocument = z.infer<typeof provenanceDocumentSchema>;
export type ProvenanceData = z.infer<typeof provenanceDataSchema>;
export type ProvenanceSource = z.infer<typeof sourceSchema>;
export type ProvenanceAssertion = z.infer<typeof assertionSchema>;
export type ProvenanceEvidence = z.infer<typeof evidenceSchema>;
