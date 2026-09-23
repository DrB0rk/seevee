// Test fixtures for the renderer. We load JSON files synchronously via
// `fs.readFileSync` so the schema parse happens once at module import
// time and every test can reuse the same parsed documents. Loading is
// centralised here so test files don't each repeat the path logic.

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { CvDocument } from '@seevee/schema';

const HERE = dirname(fileURLToPath(import.meta.url));

function loadCv(name: string): CvDocument {
  const path = resolve(HERE, `${name}.json`);
  const text = readFileSync(path, 'utf8');
  return JSON.parse(text) as CvDocument;
}

export const sparseCvFixture: CvDocument = loadCv('sparse-cv');
export const normalCvFixture: CvDocument = loadCv('normal-cv');
export const denseCvFixture: CvDocument = loadCv('dense-cv');
