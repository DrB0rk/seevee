// @ts-check
import { defineConfig } from 'astro/config';
import node from '@astrojs/node';

// Seevee Studio — Astro app that runs the local dashboard server.
// Output is 'server' so every page is rendered per-request against the
// workspace on disk. The Node adapter binds the HTTP listener.
export default defineConfig({
  output: 'server',
  adapter: node({ mode: 'standalone' }),
  server: { host: '127.0.0.1', port: 4321 },
  srcDir: './src',
  publicDir: './public',
  trailingSlash: 'never',
  devToolbar: { enabled: false },
});