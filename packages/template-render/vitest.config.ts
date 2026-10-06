import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    // Each test file compiles real Astro templates through Vite, which is
    // CPU-bound and holds an open dev server. Run files sequentially so
    // parallel workers don't starve the compiler.
    testTimeout: 120_000,
    hookTimeout: 120_000,
    pool: 'forks',
    poolOptions: { forks: { singleFork: true } },
  },
});