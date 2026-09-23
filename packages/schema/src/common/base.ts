import { z } from 'zod';

/**
 * Common primitive types shared across every Seevee resource.
 *
 * These definitions must stay in lock-step with schemas/v1/common.schema.json.
 * The drift-check script compares zod-to-json-schema output against the
 * committed artifact and fails CI on any divergence.
 */

// --- Identifiers, revisions, timestamps ---

export const idSchema = z
  .string()
  .min(3)
  .max(160)
  .regex(/^[A-Za-z][A-Za-z0-9_-]*$/, 'must start with a letter and contain only [A-Za-z0-9_-]');

export const schemaVersionSchema = z.string().regex(/^[0-9]+\.[0-9]+\.[0-9]+$/);

export const revisionSchema = z.number().int().min(0);

export const timestampSchema = z.string().datetime({ offset: true });

export const jsonPointerSchema = z
  .string()
  .regex(/^(?:\/(?:[^~/]|~0|~1)*)*$/, 'must be a valid JSON Pointer (RFC 6901)');

/**
 * Extensions are intentionally permissive: vendor-/user-defined metadata.
 * Keys are dotted names (seevee.*, user.*, etc.) and values are arbitrary JSON.
 */
export const extensionsSchema = z.record(z.unknown()).refine(
  (record) =>
    Object.keys(record).every((key) =>
      /^[A-Za-z0-9][A-Za-z0-9._-]*(?:\.[A-Za-z0-9][A-Za-z0-9._-]*)+$/.test(key),
    ),
  {
    message: 'extension keys must be dotted names with at least two segments',
  },
);

// --- Dates ---

export const partialDateSchema = z.discriminatedUnion('precision', [
  z.object({
    precision: z.literal('year'),
    year: z.number().int().min(1).max(9999),
  }),
  z.object({
    precision: z.literal('month'),
    year: z.number().int().min(1).max(9999),
    month: z.number().int().min(1).max(12),
  }),
  z.object({
    precision: z.literal('day'),
    year: z.number().int().min(1).max(9999),
    month: z.number().int().min(1).max(12),
    day: z.number().int().min(1).max(31),
  }),
]);

export const dateRangeSchema = z
  .object({
    start: partialDateSchema,
    end: partialDateSchema.optional(),
    ongoing: z.boolean().optional(),
    label: z.string().optional(),
  })
  .refine(
    (range) => {
      if (range.end === undefined || range.ongoing) return true;
      // Year-major ordering check across precision changes.
      const startYear = range.start.year;
      const endYear = range.end.year;
      if (startYear !== endYear) return startYear < endYear;
      const startMonth = 'month' in range.start ? range.start.month : 1;
      const endMonth = 'month' in range.end ? range.end.month : 12;
      if (startMonth !== endMonth) return startMonth < endMonth;
      const startDay = 'day' in range.start ? range.start.day : 1;
      const endDay = 'day' in range.end ? range.end.day : 28;
      return startDay <= endDay;
    },
    { message: 'dateRange.start must be <= dateRange.end', path: ['end'] },
  );

// --- References to semantic CV nodes / fields / sections ---

export const nodeRefSchema = z.object({
  nodeId: idSchema,
  pointer: jsonPointerSchema.optional(),
});

export const fieldRefSchema = z.object({
  nodeId: idSchema,
  field: z.string().min(1),
  pointer: jsonPointerSchema.optional(),
});

export const sectionRefSchema = z.object({
  sectionId: idSchema,
});

export const semanticRefSchema = z.object({
  nodeId: idSchema.optional(),
  sectionId: idSchema.optional(),
  field: z.string().optional(),
  pointer: jsonPointerSchema.optional(),
});

// --- Actor & link ---

export const actorSchema = z.object({
  kind: z.enum(['user', 'agent', 'system', 'unknown']),
  id: z.string().min(1).optional(),
  display: z.string().optional(),
  extensions: extensionsSchema.optional(),
});

export const linkSchema = z.object({
  rel: z.string().min(1),
  href: z.string().min(1),
  title: z.string().optional(),
  mime: z.string().optional(),
  extensions: extensionsSchema.optional(),
});

// --- Inferred TS types ---

export type Id = z.infer<typeof idSchema>;
export type SchemaVersion = z.infer<typeof schemaVersionSchema>;
export type Revision = z.infer<typeof revisionSchema>;
export type Timestamp = z.infer<typeof timestampSchema>;
export type JsonPointer = z.infer<typeof jsonPointerSchema>;
export type Extensions = z.infer<typeof extensionsSchema>;
export type PartialDate = z.infer<typeof partialDateSchema>;
export type DateRange = z.infer<typeof dateRangeSchema>;
export type NodeRef = z.infer<typeof nodeRefSchema>;
export type FieldRef = z.infer<typeof fieldRefSchema>;
export type SectionRef = z.infer<typeof sectionRefSchema>;
export type SemanticRef = z.infer<typeof semanticRefSchema>;
export type Actor = z.infer<typeof actorSchema>;
export type Link = z.infer<typeof linkSchema>;

/** A factory for the envelope common to all revisioned Seevee resources. */
export function envelopeSchema<T extends z.ZodTypeAny>(data: T, kindLiteral: string) {
  return z
    .object({
      kind: z.literal(kindLiteral),
      schemaVersion: schemaVersionSchema,
      id: idSchema,
      revision: revisionSchema,
      createdAt: timestampSchema,
      updatedAt: timestampSchema,
      data,
    })
    .strict();
}
