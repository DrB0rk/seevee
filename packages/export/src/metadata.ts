// Export-metadata persistence. After every successful export the
// pipeline writes a JSON record at
// `<workspaceRoot>/.seevee/exports/<exportId>.json`. The record
// mirrors `ExportResult` so callers can grep the directory for the
// full provenance chain (CV id, presentation id, template id,
// timestamps, page count, hash) without re-running the export.
//
// We do NOT overwrite an existing metadata file: each `exportId` is
// generated fresh, so collisions are vanishingly unlikely and a
// re-render simply picks a new id.

import { mkdir, writeFile, access } from 'node:fs/promises';
import { dirname, isAbsolute, resolve } from 'node:path';

import { IoError } from './errors.js';
import type { ExportMetadataRecord } from './types.js';

const SEEVEE_DIR = '.seevee';
const EXPORTS_DIR = 'exports';

export interface WriteMetadataOptions {
  readonly workspaceRoot: string;
  readonly exportId: string;
  readonly record: ExportMetadataRecord;
  /**
   * Override for tests; lets the caller swap the filesystem
   * operations for an in-memory implementation.
   */
  readonly fs?: MetadataFs;
}

/** Minimal filesystem surface used by the writer; overridable in tests. */
export interface MetadataFs {
  mkdir(path: string, options: { recursive: boolean }): Promise<void>;
  writeFile(path: string, body: string): Promise<void>;
  access(path: string): Promise<void>;
}

const defaultFs: MetadataFs = {
  async mkdir(path, options) {
    await mkdir(path, options);
  },
  async writeFile(path, body) {
    await writeFile(path, body, 'utf8');
  },
  async access(path) {
    await access(path);
  },
};

/**
 * Compute the absolute path where the metadata record for `exportId`
 * will be written. The directory itself is not created by this call
 * — use `writeExportMetadata` to do both.
 */
export function exportMetadataPath(
  workspaceRoot: string,
  exportId: string,
): string {
  const root = isAbsolute(workspaceRoot)
    ? workspaceRoot
    : resolve(workspaceRoot);
  return resolve(root, SEEVEE_DIR, EXPORTS_DIR, `${exportId}.json`);
}

/**
 * Persist an export metadata record to
 * `<workspaceRoot>/.seevee/exports/<exportId>.json`. The directory is
 * created (`mkdir { recursive: true }`) on demand; existing files
 * with the same id are not touched (we never collide by construction
 * — see `generateExportId`).
 */
export async function writeExportMetadata(
  options: WriteMetadataOptions,
): Promise<string> {
  if (!isAbsolute(options.workspaceRoot)) {
    throw new IoError(
      `workspaceRoot must be absolute (got '${options.workspaceRoot}')`,
    );
  }
  const target = exportMetadataPath(options.workspaceRoot, options.exportId);
  const fs = options.fs ?? defaultFs;

  const directory = dirname(target);
  try {
    await fs.mkdir(directory, { recursive: true });
    // Confirm the directory exists by trying to access it. mkdir is
    // idempotent under `recursive: true`, but on some filesystems we
    // still want a hard assertion that the path is reachable.
    await fs.access(directory);
  } catch (error) {
    throw new IoError(
      `failed to create export metadata directory '${directory}': ${(error as Error).message}`,
    );
  }

  const serialized = JSON.stringify(options.record, null, 2);
  try {
    await fs.writeFile(target, serialized);
  } catch (error) {
    throw new IoError(
      `failed to write export metadata '${target}': ${(error as Error).message}`,
    );
  }
  return target;
}

/**
 * Mint a fresh `exportId`. The id is timestamp + 64 bits of random hex,
 * which is more than enough to prevent collisions for an export run
 * rate any single workspace will see.
 */
export function generateExportId(now: Date = new Date()): string {
  const random = randomHex(16);
  return `exp_${now.toISOString().replace(/[:.]/g, '-')}_${random}`;
}

function randomHex(bytes: number): string {
  const bytesArr = new Uint8Array(bytes);
  crypto.getRandomValues(bytesArr);
  let out = '';
  for (const byte of bytesArr) {
    out += byte.toString(16).padStart(2, '0');
  }
  return out;
}
