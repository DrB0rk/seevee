#!/usr/bin/env node
/**
 * Seevee Studio — production entry point.
 *
 * When `astro build` runs, Astro writes the standalone Node server to
 * `dist/server/entry.mjs`. Running `node ./server.js` after a build
 * preserves the CLI's expectation of a single `node` entry that owns
 * the HTTP listener. In dev, `astro dev` performs the same role.
 */
import('./dist/server/entry.mjs').catch((err) => {
  console.error('Seevee Studio failed to start:', err);
  process.exit(1);
});