import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts', 'tests/**/*.test.tsx'],
    environment: 'node',
    // The preview test boots a real Vite + Astro server through
    // @seevee/template-render, and the renderer rebuilds that server when a
    // concurrent test has torn down its transport. On a loaded CI runner that
    // can exceed 30s, so the budget matches the renderer's retry bound rather
    // than assuming a warm cache.
    testTimeout: 120_000,
  },
  resolve: {
    alias: {
      '@': path.join(here, 'src'),
    },
  },
  esbuild: {
    jsx: 'automatic',
  },
});
