// @ts-check
import { defineConfig } from 'astro/config';
import node from '@astrojs/node';
import react from '@astrojs/react';

// Seevee Studio — Astro app that runs the local dashboard server.
// Output is 'server' so every page is rendered per-request against the
// workspace on disk. The Node adapter binds the HTTP listener.
export default defineConfig({
  output: 'server',
  adapter: node({ mode: 'standalone' }),
  integrations: [react()],
  server: { host: '127.0.0.1', port: 4321 },
  srcDir: './src',
  publicDir: './public',
  trailingSlash: 'never',
  devToolbar: { enabled: false },
  vite: {
    // The `@seevee/*` workspace packages publish raw TypeScript through their
    // `exports` maps (`"./common": "./src/common/index.ts"`), and those
    // sources import each other with `.js` specifiers. Vite's default SSR
    // externalization hands such packages to Node's ESM loader, which cannot
    // resolve either the `.ts` entry or its internal `.js` specifiers, so the
    // dev server 500s on the first route that touches workspace code.
    // Keeping them in Vite's transform pipeline is what makes `astro dev` and
    // `astro build` work against an unbuilt workspace.
    ssr: {
      noExternal: [/^@seevee\//],
      // The Vite toolchain resolves platform-specific native binaries at
      // import time. Marking it external is required on both axes: with
      // `rollupOptions.external` alone, Vite's CommonJS transform still
      // inlined esbuild's `lib/main.js`, whose `requireNative()` runs on
      // module load and throws `__dirname is not defined in ES module scope`
      // once Rollup rewrote it into the ESM server bundle. That made every
      // template render 500 in a release build.
      external: ['esbuild', 'rollup', 'playwright', 'playwright-core'],
    },
    optimizeDeps: {
      // Keep the native-binary toolchain out of the dep-optimization pass so
      // its platform-specific entry stays resolved at runtime.
      exclude: ['esbuild', 'rollup', 'playwright', 'playwright-core'],
    },
    build: {
      rollupOptions: {
        external: [
          'esbuild',
          'rollup',
          'playwright',
          'playwright-core',
          // macOS-only optional peers of the toolchain. Genuinely absent on
          // Linux and Windows, where the modules fall back to polling.
          'fsevents',
          'kerberos',
        ],
      },
    },
  },
});