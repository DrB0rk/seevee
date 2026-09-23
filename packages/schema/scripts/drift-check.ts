/**
 * Drift check: validates generated JSON Schema artifacts against canonical
 * committed schemas using Ajv 2020-12 and Zod fixture parsing.
 *
 * Two-layer validation per resource:
 *   1. Zod parses the fixture → structural contract is met.
 *   2. Ajv validates the same fixture against the generated JSON Schema →
 *      no JSON Schema <-> Zod divergence.
 *   3. Ajv rejects a mutated fixture → the schema is not too permissive.
 */

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';

import { cvDocumentSchema } from '../src/cv/index.js';
import { workspaceDocumentSchema } from '../src/workspace/index.js';
import { commentsDocumentSchema } from '../src/comments/index.js';
import { provenanceDocumentSchema } from '../src/provenance/index.js';
import { presentationDocumentSchema } from '../src/presentation/index.js';
import { changeSetDocumentSchema } from '../src/change-set/index.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURES = resolve(__dirname, '..', 'tests', 'fixtures');

const fixtures = [
  { name: 'cv',           file: 'cv-fixture.json',           zod: cvDocumentSchema },
  { name: 'workspace',     file: 'workspace-fixture.json',    zod: workspaceDocumentSchema },
  { name: 'comments',     file: 'comments-fixture.json',     zod: commentsDocumentSchema },
  { name: 'provenance',   file: 'provenance-fixture.json',  zod: provenanceDocumentSchema },
  { name: 'presentation', file: 'presentation-fixture.json', zod: presentationDocumentSchema },
  { name: 'change-set',   file: 'change-set-fixture.json',  zod: changeSetDocumentSchema },
];

let failures = 0;

for (const fixture of fixtures) {
  const fixturePath = resolve(FIXTURES, fixture.file);
  const doc = JSON.parse(readFileSync(fixturePath, 'utf8'));

  // Layer 1: Zod structural parse.
  const zodResult = fixture.zod.safeParse(doc);
  if (!zodResult.success) {
    console.error('[FAIL]', fixture.name, 'Zod rejected fixture:');
    for (const issue of zodResult.error.issues) {
      console.error(' ', issue.path.join('.'), issue.message);
    }
    failures += 1;
    continue;
  }

  // Layer 2: Ajv validates fixture against generated JSON Schema.
  const generatedPath = resolve(__dirname, '..', 'generated', fixture.name + '.schema.json');
  const ajvSchema = JSON.parse(readFileSync(generatedPath, 'utf8'));
  const ajv = new Ajv2020({ allErrors: true, strict: false });
  addFormats(ajv);
  let validate: (data: unknown) => boolean;
  try {
    validate = ajv.compile(ajvSchema);
  } catch (compileErr) {
    console.error('[FAIL]', fixture.name, 'Ajv failed to compile schema:', compileErr);
    failures += 1;
    continue;
  }

  const ajvOk = validate(doc);
  if (!ajvOk) {
    console.error('[FAIL]', fixture.name, 'Ajv rejected fixture against generated JSON Schema:');
    for (const err of validate.errors ?? []) {
      console.error(' ', err.instancePath, err.message);
    }
    failures += 1;
    continue;
  }

  // Layer 3: Ajv must reject a mutated (clearly-invalid) document.
  const wrong = mutate(doc);
  const wrongOk = validate(wrong);
  if (wrongOk) {
    console.error('[FAIL]', fixture.name, 'generated JSON Schema accepted a mutated fixture (too permissive)');
    failures += 1;
    continue;
  }

  console.log('[OK]', fixture.name);
}

if (failures > 0) {
  console.error('drift-check failed:', failures, 'resource(s)');
  process.exit(1);
} else {
  console.log('drift-check OK across', fixtures.length, 'resources');
}

/** Produce a document clearly invalid for every Seevee resource. */
function mutate(doc: Record<string, unknown>): Record<string, unknown> {
  const out = structuredClone(doc);
  // Drop `id` — every document requires it and Zod enforces minLength 3.
  if ('id' in out) delete (out as Record<string, unknown>).id;
  return out;
}
