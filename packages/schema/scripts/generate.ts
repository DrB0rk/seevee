/**
 * JSON Schema 2020-12 generation from the canonical Zod source.
 *
 * Run via:  pnpm --filter @seevee/schema run generate
 *
 * Outputs go to packages/schema/generated/*.schema.json and must match the
 * committed schemas under /schemas/v1/*.schema.json (the drift-check script
 * asserts equivalence).
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { zodToJsonSchema } from 'zod-to-json-schema';

import {
  cvDocumentSchema,
  workspaceDocumentSchema,
  commentsDocumentSchema,
  provenanceDocumentSchema,
  presentationDocumentSchema,
  sourceDocumentSchema,
  changeSetDocumentSchema,
  templateManifestDocumentSchema,
  stylePresetDocumentSchema,
  agentRunDocumentSchema,
  renderDiagnosticsDocumentSchema,
} from '../src/index.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = resolve(__dirname, '..', 'generated');

type Resource = {
  schema: unknown;
  filename: string;
  baseId: string;
};

const resources: Resource[] = [
  { schema: cvDocumentSchema, filename: 'cv.schema.json', baseId: 'https://seevee.dev/schema/v1/cv.schema.json' },
  { schema: workspaceDocumentSchema, filename: 'workspace.schema.json', baseId: 'https://seevee.dev/schema/v1/workspace.schema.json' },
  { schema: commentsDocumentSchema, filename: 'comments.schema.json', baseId: 'https://seevee.dev/schema/v1/comments.schema.json' },
  { schema: provenanceDocumentSchema, filename: 'provenance.schema.json', baseId: 'https://seevee.dev/schema/v1/provenance.schema.json' },
  { schema: presentationDocumentSchema, filename: 'presentation.schema.json', baseId: 'https://seevee.dev/schema/v1/presentation.schema.json' },
  { schema: sourceDocumentSchema, filename: 'source.schema.json', baseId: 'https://seevee.dev/schema/v1/source.schema.json' },
  { schema: changeSetDocumentSchema, filename: 'change-set.schema.json', baseId: 'https://seevee.dev/schema/v1/change-set.schema.json' },
  { schema: templateManifestDocumentSchema, filename: 'template-manifest.schema.json', baseId: 'https://seevee.dev/schema/v1/template-manifest.schema.json' },
  { schema: stylePresetDocumentSchema, filename: 'style-preset.schema.json', baseId: 'https://seevee.dev/schema/v1/style-preset.schema.json' },
  { schema: agentRunDocumentSchema, filename: 'agent-run.schema.json', baseId: 'https://seevee.dev/schema/v1/agent-run.schema.json' },
  { schema: renderDiagnosticsDocumentSchema, filename: 'render-diagnostics.schema.json', baseId: 'https://seevee.dev/schema/v1/render-diagnostics.schema.json' },
];

/**
 * Normalize a generated schema to strict JSON Schema 2020-12.
 *
 * zod-to-json-schema can emit the draft-04 boolean form for exclusive
 * bounds (`{ minimum: 0, exclusiveMinimum: true }`). Draft 2020-12 requires
 * the numeric form (`{ exclusiveMinimum: 0 }`), so we promote in place.
 */
function toDraft2020(schema: unknown): void {
  if (schema === null || typeof schema !== 'object') return;
  if (Array.isArray(schema)) {
    for (const item of schema) toDraft2020(item);
    return;
  }
  const obj = schema as Record<string, unknown>;
  if (obj.exclusiveMinimum === true && typeof obj.minimum === 'number') {
    obj.exclusiveMinimum = obj.minimum;
  }
  if (obj.exclusiveMaximum === true && typeof obj.maximum === 'number') {
    obj.exclusiveMaximum = obj.maximum;
  }
  for (const value of Object.values(obj)) toDraft2020(value);
}

mkdirSync(OUT_DIR, { recursive: true });

for (const r of resources) {
  const json = zodToJsonSchema(r.schema as Parameters<typeof zodToJsonSchema>[0], {
    $refStrategy: 'none',
    target: 'jsonSchema2020-12',
    errorMessages: false,
    markdownDescription: false,
    strictScalars: false,
  }) as Record<string, unknown>;

  toDraft2020(json);
  json.$id = r.baseId;
  json.$schema = 'https://json-schema.org/draft/2020-12/schema';

  writeFileSync(
    resolve(OUT_DIR, r.filename),
    JSON.stringify(json, null, 2) + '\n',
  );
  console.log('wrote', r.filename);
}

// Emit a minimal common schema stub. The real common types are inlined
// across the generated resources; a separate common.schema.json with all
// shared defs would be produced by a dedicated common/ Zod module when
// needed.
const commonDefs: Record<string, unknown> = {
  id: { type: 'string', minLength: 3, maxLength: 160, pattern: '^[A-Za-z][A-Za-z0-9_-]*$' },
  schemaVersion: { type: 'string', pattern: '^[0-9]+\\.[0-9]+\\.[0-9]+$' },
  revision: { type: 'integer', minimum: 0 },
  timestamp: { type: 'string', format: 'date-time' },
  jsonPointer: { type: 'string', pattern: '^(?:/(?:[^~/]|~0|~1)*)*$' },
  extensions: { type: 'object', additionalProperties: true },
};

writeFileSync(
  resolve(OUT_DIR, 'common.schema.json'),
  JSON.stringify(
    {
      $schema: 'https://json-schema.org/draft/2020-12/schema',
      $id: 'https://seevee.dev/schema/v1/common.schema.json',
      title: 'Seevee Common Types',
      $defs: commonDefs,
    },
    null,
    2,
  ) + '\n',
);
console.log('wrote common.schema.json');
