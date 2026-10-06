// Astro runtime loader.
//
// The whole point of this package is to execute a template's real `.astro`
// source, which means driving Astro's own compile pipeline. Astro ships no
// first-class "render this one file" API for server output outside of a
// configured project, so we assemble the same pipeline Astro's dev server
// uses:
//
//   resolveConfig → createSettings → astroPlugin → Vite dev server (SSR) →
//   experimental_AstroContainer.renderToString()
//
// Every one of those steps is required; skipping the Astro Vite plugin makes
// Vite parse `.astro` as raw JSX and fail with a syntax error.
//
// Astro and Vite are declared dependencies here, but nothing imports them at
// module scope: the dynamic imports below keep `import type` the only compile
// -time coupling, so a consumer that merely imports our types does not drag
// Astro into its own module graph.
//
// Astro's internal dist paths (`dist/core/config`, `dist/vite-plugin-astro`)
// are deliberately absent from its `exports` map, so they are resolved as
// absolute file paths off Astro's own package directory rather than imported
// by specifier.

import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';

const hostRequire = createRequire(import.meta.url);

/**
 * Absolute URL for a file inside Astro's package directory. Bypasses the
 * `exports` map, which does not cover Astro's internal dist entry points.
 */
function astroInternalUrl(...segments: string[]): string {
  const astroDir = dirname(hostRequire.resolve('astro/package.json'));
  return pathToFileURL(join(astroDir, ...segments)).href;
}

/**
 * The subset of Astro's config resolution we depend on. Typed structurally
 * rather than by importing Astro's (very wide) option types, because the
 * callers only ever pass the three fields below.
 */
export interface AstroResolveConfigOptions {
  readonly root: string;
  readonly output: 'server';
  readonly srcDir: string;
}

/** Minimal shape of the Astro settings object we read. */
export interface AstroSettingsLike {
  readonly viteConfig: Readonly<Record<string, unknown>>;
}

/** The Astro Vite plugin factory. */
export type AstroVitePluginFactory = (options: {
  settings: AstroSettingsLike;
  logger: unknown;
}) => readonly unknown[];

/** `astro/container`'s container, narrowed to what we call. */
export interface AstroContainerLike {
  renderToString(
    component: unknown,
    options?: { props?: Record<string, unknown>; slots?: Record<string, unknown> },
  ): Promise<string>;
}

export interface AstroContainerModule {
  readonly experimental_AstroContainer: {
    create(options?: Record<string, unknown>): Promise<AstroContainerLike>;
  };
}

export interface AstroConfigModule {
  resolveConfig(
    options: AstroResolveConfigOptions,
    root: string,
  ): Promise<{ astroConfig: unknown }>;
  createSettings(astroConfig: unknown, root: string): Promise<AstroSettingsLike>;
  createNodeLogger(options: { dest: unknown; level?: string }): unknown;
}

export interface AstroRuntimeModules {
  readonly config: AstroConfigModule;
  readonly vitePlugin: AstroVitePluginFactory;
  readonly container: AstroContainerModule;
}

let cached: Promise<AstroRuntimeModules> | null = null;

/**
 * Load Astro's config, Vite-plugin, and container entry points.
 *
 * Resolved once per process and memoised: these are expensive to import and
 * completely stateless with respect to a particular template.
 */
export function loadAstroRuntime(): Promise<AstroRuntimeModules> {
  cached ??= (async () => {
    const [configModule, vitePluginModule, containerModule] = await Promise.all([
      import(astroInternalUrl('dist', 'core', 'config', 'index.js')),
      import(astroInternalUrl('dist', 'vite-plugin-astro', 'index.js')),
      import('astro/container'),
    ]);
    // Astro's published subpath entry points have no usable .d.ts, so each
    // dynamic import is checked against a structural shape declared above
    // rather than against Astro's own (untyped) declarations.
    const config: AstroConfigModule = configModule as unknown as AstroConfigModule;
    const container: AstroContainerModule = containerModule as unknown as AstroContainerModule;
    const vitePluginExport: { default: AstroVitePluginFactory } = vitePluginModule;
    return { config, vitePlugin: vitePluginExport.default, container };
  })();
  return cached;
}

/** Drop the memoised runtime. Exposed for tests that need a clean slate. */
export function resetAstroRuntimeCache(): void {
  cached = null;
}