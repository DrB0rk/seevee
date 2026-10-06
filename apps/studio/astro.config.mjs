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
    },
    build: {
      rollupOptions: {
        external: [
          // `@seevee/export` depends on Playwright, which ships platform
          // binaries and optional native bindings that Rollup cannot bundle
          // (playwright-core imports `kerberos`). The bundle ships Playwright
          // as a real runtime dependency, so leave it to Node's loader rather
          // than inlining it into the server build.
          'playwright',
          'playwright-core',
          // macOS-only optional peers of the Vite/Rollup toolchain. They are
          // genuinely absent on Linux and Windows, where the modules fall
          // back to polling.
          'fsevents',
          'kerberos',
        ],
      },
    },
  },
});