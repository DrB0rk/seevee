// Manifest validation. The compiler treats `template.json` as untrusted
// input even though the caller is expected to pass a parsed manifest: we
// re-validate against `templateManifestDocumentSchema` so a wrong shape
// surfaces here, not deep inside the policy scan or the renderer.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { templateManifestDocumentSchema } from '@seevee/schema';
import type { TemplateManifestDocument } from '@seevee/schema';
import { z } from 'zod';

import { ManifestError } from './errors.js';

/** Parse a `template.json` file and return the validated document. */
export function readManifestFromDisk(sourceRoot: string): TemplateManifestDocument {
  const manifestPath = join(sourceRoot, 'template.json');
  let raw: string;
  try {
    raw = readFileSync(manifestPath, 'utf8');
  } catch (cause) {
    throw new ManifestError(
      `could not read ${manifestPath}`,
      { cause, source: manifestPath },
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (cause) {
    throw new ManifestError(
      `template.json is not valid JSON: ${manifestPath}`,
      { cause, source: manifestPath },
    );
  }

  return validateManifest(parsed);
}

/**
 * Validate an already-parsed manifest payload. Exposed so callers that
 * loaded the manifest via a different path (e.g. from a workspace store)
 * can run the same gate the compiler uses.
 */
export function validateManifest(input: unknown): TemplateManifestDocument {
  const result = templateManifestDocumentSchema.safeParse(input);
  if (!result.success) {
    throw new ManifestError(formatIssues(result.error), { cause: result.error });
  }
  return result.data;
}

/** Render a Zod issue list into a one-line summary the caller can log. */
function formatIssues(err: z.ZodError): string {
  const lines = err.issues.map((issue) => {
    const path = issue.path.length === 0 ? '<root>' : issue.path.join('.');
    return `${path}: ${issue.message}`;
  });
  return `manifest validation failed (${lines.length} issue(s)): ${lines.join('; ')}`;
}