#!/usr/bin/env node
/**
 * check_package_entry.mjs — verify a bundled package ships the files its
 * manifest points at.
 *
 * Usage: node scripts/check_package_entry.mjs <package-dir>
 *
 * The bundler rewrites a workspace package's entry points to its compiled
 * output when the package's build emits JavaScript, and leaves them on the
 * TypeScript source when it does not. This check confirms the manifest's
 * declared entry actually exists inside the bundle, so a package that got
 * rewritten to a `dist/` it never produced fails here instead of at runtime.
 */

import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const packageDir = process.argv[2];

if (!packageDir) {
  console.error('usage: check_package_entry.mjs <package-dir>');
  process.exit(64);
}

const root = resolve(packageDir);
const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));

const entries = new Set();
if (typeof manifest.main === 'string') entries.add(manifest.main);
if (manifest.exports && typeof manifest.exports === 'object') {
  const collect = (value) => {
    if (typeof value === 'string') entries.add(value);
    else if (value && typeof value === 'object') Object.values(value).forEach(collect);
  };
  collect(manifest.exports);
}

if (entries.size === 0) entries.add('./index.js');

const missing = [...entries].filter((entry) => !existsSync(join(root, entry)));

if (missing.length > 0) {
  console.error(`${manifest.name ?? root}: entry point(s) missing from the bundle: ${missing.join(', ')}`);
  process.exit(1);
}