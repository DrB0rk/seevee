// Template manifest reading.
//
// `template.json` is the template's declaration of identity and entry point.
// It is validated against the canonical schema so a malformed manifest fails
// with a field-level message rather than surfacing as a mystery render crash.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { templateManifestDocumentSchema } from '@seevee/schema';
import type { TemplateManifestDocument } from '@seevee/schema';

import { ManifestInvalidError, ManifestNotFoundError } from './errors.js';

/** Read and validate `template.json` from a template root. */
export function readTemplateManifest(templateRoot: string): TemplateManifestDocument {
  const manifestPath = join(templateRoot, 'template.json');
  let raw: string;
  try {
    raw = readFileSync(manifestPath, 'utf8');
  } catch (error) {
    throw new ManifestNotFoundError(templateRoot, { cause: error });
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new ManifestInvalidError(
      templateRoot,
      error instanceof Error ? error.message : String(error),
      { cause: error },
    );
  }

  const result = templateManifestDocumentSchema.safeParse(parsed);
  if (!result.success) {
    throw new ManifestInvalidError(templateRoot, formatIssues(result.error.issues));
  }
  return result.data;
}

/**
 * Flatten zod issues into one line. The dashboard renders this string
 * directly in a template-authoring error panel.
 */
function formatIssues(issues: readonly { path: PropertyKey[]; message: string }[]): string {
  return issues
    .map((issue) => {
      const path = issue.path.length === 0 ? '<root>' : issue.path.map(String).join('.');
      return `${path}: ${issue.message}`;
    })
    .join('; ');
}