#!/usr/bin/env node
/**
 * runtime_packages.mjs — resolve the @seevee/* packages a runtime bundle ships.
 *
 * Usage: node scripts/runtime_packages.mjs <repo-root> <pkg-dir-name>...
 *
 * Prints the bundle's package directory names, one per line, in a stable
 * order. The given entry packages come first (in the order supplied), followed
 * by every transitive workspace dependency reachable from their
 * `dependencies` / `optionalDependencies` manifests.
 *
 * The list is derived from real package manifests rather than a hardcoded
 * string so a runtime package that gains a new @seevee/* dependency (or a
 * package that ships only its TS source) is picked up without editing the
 * bundling script.
 *
 * devDependencies are deliberately ignored: they are build-time only and the
 * bundle resolves production dependencies separately.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const [repoRoot, ...entries] = process.argv.slice(2);

if (!repoRoot || entries.length === 0) {
  console.error('usage: runtime_packages.mjs <repo-root> <pkg-dir-name>...');
  process.exit(64);
}

const SCOPE = '@seevee/';

/** Read a package manifest, returning null when it is not a workspace package. */
function readManifest(dirName) {
  try {
    const manifest = JSON.parse(readFileSync(join(repoRoot, 'packages', dirName, 'package.json'), 'utf8'));
    return manifest && typeof manifest.name === 'string' ? manifest : null;
  } catch {
    return null;
  }
}

const resolved = [];
const seen = new Set();

const visit = (dirName) => {
  if (seen.has(dirName)) return;
  seen.add(dirName);

  const manifest = readManifest(dirName);
  if (!manifest) {
    // A missing manifest is a packaging bug: the bundle would ship a hole.
    throw new Error(`runtime_packages.mjs: packages/${dirName} has no readable package.json`);
  }

  resolved.push(dirName);

  const dependencies = {
    ...manifest.dependencies,
    ...manifest.optionalDependencies,
  };
  for (const dependency of Object.keys(dependencies)) {
    if (!dependency.startsWith(SCOPE)) continue;
    const dependencyDirName = dependency.slice(SCOPE.length);
    if (!dependencyDirName) {
      throw new Error(`runtime_packages.mjs: packages/${dirName} declares a malformed dependency: ${dependency}`);
    }
    visit(dependencyDirName);
  }
};

for (const entry of entries) visit(entry);

process.stdout.write(`${resolved.join('\n')}\n`);