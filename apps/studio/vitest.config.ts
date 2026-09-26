import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts', 'tests/**/*.test.tsx'],
    environment: 'node',
    testTimeout: 30_000,
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
