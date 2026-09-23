// Compiled-template-artifact loader. The export pipeline passes the
// `templateArtifactPath` (a directory or a manifest file) into
// `loadCompiledArtifact`, which:
//
//   1. confirms the path is absolute;
//   2. reads the manifest JSON (either `<dir>/manifest.json` or the
//      path itself when it points at the manifest);
//   3. validates the manifest against the `TemplateManifestDocument`
//      Zod schema from `@seevee/schema`;
//   4. returns a `LoadedTemplateArtifact` carrying the manifest plus
//      a resolved `templateSource` (best-effort: empty string when the
//      artifact is a directory without an explicit source file).
//
// We do NOT execute the artifact. The renderer is responsible for
// turning it into HTML at render time.

import { readFile, stat } from 'node:fs/promises';
import { isAbsolute, resolve, dirname } from 'node:path';

import { templateManifestDocumentSchema } from '@seevee/schema';
import type { TemplateManifestDocument } from '@seevee/schema';

import { TemplateArtifactError } from './errors.js';

export interface LoadArtifactOptions {
  readonly templateArtifactPath: string;
  /**
   * Override for tests; defaults to `node:fs/promises.readFile`.
   */
  readonly read?: (absPath: string) => Promise<string>;
}

export interface LoadedTemplateArtifact {
  readonly manifest: TemplateManifestDocument;
  /** Best-effort template source for the renderer; empty when unknown. */
  readonly templateSource: string;
  /** Directory the manifest was loaded from. */
  readonly artifactDir: string;
}

export async function loadCompiledArtifact(
  options: LoadArtifactOptions,
): Promise<LoadedTemplateArtifact> {
  const input = options.templateArtifactPath;
  if (!isAbsolute(input)) {
    throw new TemplateArtifactError(
      `templateArtifactPath must be absolute (got '${input}')`,
    );
  }

  let manifestPath: string;
  let artifactDir: string;
  let templateSourcePath: string | undefined;
  const stats = await stat(input).catch(() => null);
  if (stats === null) {
    throw new TemplateArtifactError(
      `templateArtifactPath does not exist: '${input}'`,
    );
  }
  if (stats.isDirectory()) {
    artifactDir = input;
    manifestPath = resolve(input, 'manifest.json');
    const manifestStat = await stat(manifestPath).catch(() => null);
    if (manifestStat === null || !manifestStat.isFile()) {
      throw new TemplateArtifactError(
        `templateArtifactPath='${input}' is a directory but does not contain manifest.json`,
      );
    }
    const sourceCandidate = resolve(input, 'source.astro');
    const sourceStat = await stat(sourceCandidate).catch(() => null);
    templateSourcePath = sourceStat !== null && sourceStat.isFile()
      ? sourceCandidate
      : undefined;
  } else if (stats.isFile()) {
    manifestPath = input;
    artifactDir = dirname(input);
  } else {
    throw new TemplateArtifactError(
      `templateArtifactPath='${input}' is not a directory or regular file`,
    );
  }

  const read = options.read ?? defaultRead;
  const manifestText = await read(manifestPath);
  let manifestJson: unknown;
  try {
    manifestJson = JSON.parse(manifestText);
  } catch (error) {
    throw new TemplateArtifactError(
      `failed to parse manifest at '${manifestPath}': ${(error as Error).message}`,
    );
  }
  const result = templateManifestDocumentSchema.safeParse(manifestJson);
  if (!result.success) {
    const first = result.error.issues[0];
    const path = first?.path?.join('.') ?? '';
    const message = first?.message ?? 'unknown Zod issue';
    throw new TemplateArtifactError(
      `manifest at '${manifestPath}' failed validation at '${path}': ${message}`,
    );
  }

  let templateSource = '';
  if (templateSourcePath !== undefined) {
    templateSource = await read(templateSourcePath);
  }

  return {
    manifest: result.data,
    templateSource,
    artifactDir,
  };
}

async function defaultRead(absPath: string): Promise<string> {
  return readFile(absPath, 'utf8');
}
