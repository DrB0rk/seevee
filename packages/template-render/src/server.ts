// The Vite dev-server pool: one cached server per template root.
//
// Renders are frequent (the dashboard re-renders on every edit) and booting a
// Vite server + running Astro's compiler is expensive, so servers are cached
// per `templateRoot` and reused. Cache invalidation is the caller's job — the
// studio owns the file watcher and calls `invalidateTemplate()` when template
// source changes.
//
// Module resolution is the subtle part. Templates live outside the pnpm
// workspace (`pnpm-workspace.yaml` excludes `!templates`), so Vite cannot
// resolve `astro/*`, `zod`, or `@seevee/*` from a template's own directory:
// pnpm's strict layout only materialises `node_modules` for declared
// dependencies, and `templates/**` declares none. Hand-made symlinks fix it
// but are invisible to a clean `pnpm install`. Instead we resolve those
// specifiers here — to this package's real dependencies — via a Vite
// `resolveId` hook that runs before externalization, paired with
// `ssr.noExternal` so the resolved modules are transformed rather than
// externalised to Node (a bare `astro/compiler-runtime` would otherwise be
// looked up relative to the template and fail).

import { createRequire } from 'node:module';
import { dirname, isAbsolute, join, relative, resolve as resolvePath } from 'node:path';
import { readFileSync, statSync } from 'node:fs';
import { Writable } from 'node:stream';
import { fileURLToPath, pathToFileURL } from 'node:url';
import type { InlineConfig, Plugin } from 'vite';

import {
  EntryNotFoundError,
  TemplateCompileError,
  TemplateRootNotFoundError,
  TemplateRuntimeError,
} from './errors.js';
import { loadAstroRuntime } from './astro-runtime.js';
import type { AstroContainerLike } from './astro-runtime.js';

/**
 * Bare specifiers a template may import that must be resolved from this
 * package's dependency tree rather than the template's own directory.
 * Anything else is a template bug and is left for Vite to report.
 *
 * `@seevee/template-sdk/components` is the entry point for the four
 * structural Astro components — it has to be listed separately because it is
 * a subpath export, not the package root.
 */
const HOST_RESOLVED_SPECIFIERS: ReadonlySet<string> = new Set([
  'astro',
  'zod',
  '@seevee/schema',
  '@seevee/template-sdk',
  '@seevee/template-sdk/components',
]);

/** Subpaths under `astro/` that a template may import. */
const ASTRO_SUBPATH_PREFIX = 'astro/';

export interface TemplateServer {
  readonly vite: {
    ssrLoadModule(url: string): Promise<Record<string, unknown>>;
    close(): Promise<void>;
    /**
     * The subset of Vite's `pluginContainer` the stylesheet collector uses to
     * resolve and load an Astro style module. Typed structurally so this file
     * keeps a single, small coupling to Vite's API surface.
     */
    readonly pluginContainer?: {
      resolveId(
        id: string,
        importer?: string,
        options?: { ssr?: boolean },
      ): Promise<{ id: string } | null>;
      load(id: string, options?: { ssr?: boolean }): Promise<unknown>;
    };
    /** Vite's module graph, used to discover which style modules exist. */
    readonly moduleGraph?: {
      getModuleById(id: string): { importedModules: Set<{ id: string | null }> } | undefined;
      getModulesByFile(file: string): Set<{ id: string | null; importedModules: Set<{ id: string | null }> }> | undefined;
    };
  };
  readonly container: AstroContainerLike;
}

interface TemplateServerSlot {
  readonly server: Promise<TemplateServer>;
}

const servers = new Map<string, TemplateServerSlot>();

/**
 * Resolve a host-owned specifier to an absolute ESM URL, or `null` when it is
 * not one of ours.
 *
 * A dual-published package (one that ships both `index.js` and `index.cjs`)
 * must resolve to its *ESM* entry: Vite evaluates the SSR module graph as ESM,
 * so landing on the CJS file dies on a bare `exports`.
 *
 * The `conditions` option that selects that entry is honoured by Node but is
 * not part of the public `require.resolve` contract, and not every loader
 * passes it through — relying on it alone made resolution silently degrade to
 * CJS under tsx while working under plain Node. So the ESM entry is chosen
 * explicitly and deterministically instead: read the package's own `exports`
 * map, pick the `import` (then `module`, then `default`) condition, and fall
 * back to a sibling `.js` of the CJS entry.
 */
function resolveHostSpecifier(source: string): string | null {
  const isHostSpecifier =
    HOST_RESOLVED_SPECIFIERS.has(source) || source.startsWith(ASTRO_SUBPATH_PREFIX);
  if (!isHostSpecifier) return null;

  const requireOptions = { paths: [PACKAGE_ROOT] } as Parameters<
    typeof esmRequire.resolve
  >[1];

  // Subpath of a dual-published package: resolve the subpath explicitly.
  const lastSlash = source.lastIndexOf('/');
  if (lastSlash > 0) {
    const packageName = source.slice(0, lastSlash);
    const subpath = `.${source.slice(lastSlash)}`;
    const esmEntry = resolveEsmSubpath(packageName, subpath);
    if (esmEntry !== null) return pathToFileURL(esmEntry).href;
  }

  try {
    const resolved = esmRequire.resolve(source, requireOptions);
    // Whole-package specifier: prefer the package's ESM entry.
    const esmEntry = resolvePackageEsmEntry(source);
    if (esmEntry !== null) return pathToFileURL(esmEntry).href;
    return pathToFileURL(resolved).href;
  } catch {
    return null;
  }
}

/**
 * Locate the ESM entry a package declares in its `exports` map, preferring
 * the `import` condition. Returns `null` when the package is not dual-published
 * or has no ESM entry.
 */
function resolvePackageEsmEntry(specifier: string): string | null {
  const packageName = specifier.startsWith('@')
    ? specifier.split('/').slice(0, 2).join('/')
    : specifier.split('/')[0];
  if (packageName === undefined || packageName === '') return null;

  const manifestPath = packageManifestPath(packageName);
  if (manifestPath === null) return null;

  let manifest: PackageManifest;
  try {
    manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as PackageManifest;
  } catch {
    return null;
  }

  const entry = manifest.exports?.['.'];
  if (entry === undefined) return null;
  const target = pickEsmTarget(entry);
  if (target === null) return null;
  return join(dirname(manifestPath), target);
}

/** Resolve `pkg/subpath` against the package's own `exports` map. */
function resolveEsmSubpath(packageName: string, subpath: string): string | null {
  const manifestPath = packageManifestPath(packageName);
  if (manifestPath === null) return null;

  let manifest: PackageManifest;
  try {
    manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as PackageManifest;
  } catch {
    return null;
  }

  const entry = manifest.exports?.[subpath];
  if (entry === undefined) return null;
  const target = pickEsmTarget(entry);
  if (target === null) return null;
  return join(dirname(manifestPath), target);
}

/** Absolute path of a package's `package.json`, or `null` if unresolvable. */
function packageManifestPath(packageName: string): string | null {
  try {
    return esmRequire.resolve(`${packageName}/package.json`, { paths: [PACKAGE_ROOT] });
  } catch {
    return null;
  }
}

/**
 * Choose the ESM file from an `exports` entry, which may be a bare string, a
 * conditions object, or (rarely) a nested subpath map.
 */
function pickEsmTarget(entry: ExportsEntry): string | null {
  if (typeof entry === 'string') return entry;
  if (entry !== null && typeof entry === 'object') {
    for (const condition of ['import', 'module', 'node', 'default']) {
      const candidate = entry[condition];
      if (typeof candidate === 'string') return candidate;
    }
  }
  return null;
}

interface ExportsEntry {
  readonly [condition: string]: string | ExportsEntry | undefined;
}

interface PackageManifest {
  readonly exports?: Readonly<Record<string, ExportsEntry>>;
}

/**
 * A `require` rooted at this package, used purely as a resolver — no host
 * module is ever *loaded* through it, only located.
 */
const esmRequire = createRequire(import.meta.url);

/** Absolute path of this package's root, used as the resolution base. */
const PACKAGE_ROOT = resolvePath(fileURLToPath(import.meta.url), '..', '..');

/**
 * Vite plugin that redirects host-owned specifiers. A `resolveId` hook is
 * used rather than `resolve.alias` because aliases are applied after SSR
 * externalization decides the module is external, which leaves the bare
 * specifier to be imported relative to the template.
 */
function hostSpecifierResolver(): {
  name: string;
  enforce: 'pre';
  resolveId(source: string): string | null;
} {
  return {
    name: 'seevee:host-specifiers',
    enforce: 'pre',
    resolveId(source: string): string | null {
      return resolveHostSpecifier(source);
    },
  };
}

/** Validate the template root and resolve a template-relative entry to a path. */
export function resolveEntryPath(templateRoot: string, entry: string): string {
  if (!isAbsolute(templateRoot)) {
    throw new TemplateRootNotFoundError(
      `templateRoot must be an absolute path, got: ${templateRoot}`,
    );
  }
  let stats;
  try {
    stats = statSync(templateRoot);
  } catch (error) {
    throw new TemplateRootNotFoundError(templateRoot, { cause: error });
  }
  if (!stats.isDirectory()) {
    throw new TemplateRootNotFoundError(templateRoot);
  }

  // `entry` is template-relative; refuse to let it escape the template root.
  const resolved = resolvePath(templateRoot, entry);
  const rel = relative(templateRoot, resolved);
  if (rel.startsWith('..') || isAbsolute(rel)) {
    throw new EntryNotFoundError(entry, resolved);
  }
  try {
    if (!statSync(resolved).isFile()) {
      throw new EntryNotFoundError(entry, resolved);
    }
  } catch (error) {
    if (error instanceof EntryNotFoundError) throw error;
    throw new EntryNotFoundError(entry, resolved, { cause: error });
  }
  return resolved;
}

/** Boot the Astro + Vite pipeline for one template root. */
async function createTemplateServer(templateRoot: string): Promise<TemplateServer> {
  const { config, vitePlugin, container } = await loadAstroRuntime();

  const { astroConfig } = await config.resolveConfig(
    { root: templateRoot, output: 'server', srcDir: './src' },
    templateRoot,
  );
  const settings = await config.createSettings(astroConfig, templateRoot);

  // Load Vite without a statically analysable specifier. A literal
  // `import('vite')` is hoisted into the Studio's Rollup graph, which inlines
  // all of Vite plus its esbuild dependency into the server bundle. esbuild's
  // `requireNative()` then runs at module load inside an ES module and throws
  // `__dirname is not defined in ES module scope`, so every template render
  // 500s in a release build. Resolving the specifier through a variable keeps
  // the import genuinely runtime-only: Vite is then loaded from node_modules
  // at request time by Node's own loader.
  const VITE_SPECIFIER = 'vite';
  const { createServer } = (await import(VITE_SPECIFIER)) as typeof import('vite');

  // The Astro Vite plugin is mandatory: without it Vite parses `.astro` as
  // raw JSX and the template fails to compile.
  const astroPlugins = vitePlugin({
    settings,
    logger: createSilentLogger(),
  }) as readonly Plugin[];

  // Vite's `InlineConfig` is typed for `createServer()` in "build the whole
  // app" mode: `ssr`/`server` are declared as their *resolved* shapes, so a
  // partial override is a type error even though `createServer` fills in the
  // rest. Spread the input shape instead of fighting it with assertions.
  const inlineConfig: InlineConfig = {
    ...(settings.viteConfig as InlineConfig),
    root: templateRoot,
    plugins: [hostSpecifierResolver(), ...astroPlugins],
    logLevel: 'error',
    // These must be transformed in-process: externalising them hands Node a
    // bare specifier it resolves relative to the template, not to us.
    ssr: {
      noExternal: [/^astro($|\/)/, /^zod($|\/)/, /^@seevee\//],
    },
    server: {
      middlewareMode: true,
      hmr: false,
      watch: null,
    },
  };

  const vite = await createServer(inlineConfig);

  const astroContainer = await container.experimental_AstroContainer.create();
  return { vite, container: astroContainer };
}

/**
 * A logger that swallows Astro's startup chatter. Astro's default node
 * logger writes to stdout, which would corrupt the studio's responses.
 */
function createSilentLogger(): unknown {
  return new Writable({
    write(_chunk: unknown, _encoding: unknown, callback: () => void) {
      callback();
    },
  });
}

async function getServer(templateRoot: string): Promise<TemplateServer> {
  let slot = servers.get(templateRoot);
  if (slot === undefined) {
    slot = { server: createTemplateServer(templateRoot) };
    servers.set(templateRoot, slot);
    // A failed boot must not poison the cache: drop the slot so the next
    // attempt retries instead of replaying the same rejection forever.
    void slot.server.catch(() => {
      if (servers.get(templateRoot) === slot) servers.delete(templateRoot);
    });
  }
  return slot.server;
}

/**
 * Classify a throwable from the compile/render pipeline.
 *
 * Errors raised while a module is being compiled carry a `loc`/`id`;
 * errors thrown from a template's own frontmatter do not, and are reported
 * as runtime errors so the dashboard does not show a source-location-less
 * compile error in the template editor.
 */
export function toTemplateError(error: unknown, entryPath: string): Error {
  if (error instanceof TemplateCompileError || error instanceof TemplateRuntimeError) {
    return error;
  }
  if (!(error instanceof Error)) {
    return new TemplateRuntimeError(String(error));
  }
  const loc = (error as { loc?: { file?: string; line?: number; column?: number } }).loc;
  const id = (error as { id?: string }).id;
  if (loc?.file !== undefined || id !== undefined) {
    return new TemplateCompileError(
      error.message,
      {
        file: loc?.file ?? id ?? entryPath,
        line: loc?.line ?? null,
        column: loc?.column ?? null,
      },
      { cause: error },
    );
  }
  return new TemplateRuntimeError(error.message, { cause: error });
}

/** Compile a template entry and return its default-export component. */
export async function loadTemplateEntry(
  templateRoot: string,
  entry: string,
): Promise<{ component: unknown; server: TemplateServer }> {
  const entryPath = resolveEntryPath(templateRoot, entry);
  const server = await getServer(templateRoot);
  let mod: Record<string, unknown>;
  try {
    mod = await server.vite.ssrLoadModule(pathToFileURL(entryPath).href);
  } catch (error) {
    throw toTemplateError(error, entryPath);
  }
  const component = mod.default;
  if (typeof component !== 'function') {
    throw new TemplateCompileError(`Template entry ${entry} has no default export`, {
      file: entryPath,
      line: null,
      column: null,
    });
  }
  return { component, server };
}

/**
 * One compiled stylesheet belonging to a template.
 *
 * `content` is the real compiled CSS text, including the `data-astro-cid-*`
 * scoping selectors Astro adds. Callers must inject it verbatim — stripping
 * the scope attributes from the markup would silently unstyle every rule.
 */
export interface TemplateStylesheet {
  /** Vite module id, unique per component style block. */
  readonly id: string;
  readonly content: string;
}

/** Vite query fragment Astro appends to a component's compiled CSS module. */
const ASTRO_STYLE_QUERY = /\?astro&type=style/;

export interface CollectTemplateStylesOptions {
  /** Absolute path to the directory holding `src/` and `template.json`. */
  readonly templateRoot: string;
  /** Template-relative entry component; resolved from the manifest when omitted. */
  readonly entry?: string;
}

/**
 * Collect the compiled stylesheets a template entry pulls in.
 *
 * WHY THIS EXISTS: `renderTemplateToHtml` returns markup with no `<style>`
 * tags. Astro's container renders components in "partial" mode, which
 * deliberately suppresses head injection — so a template's scoped CSS never
 * reaches the output even though the elements carry the matching
 * `data-astro-cid-*` attributes. Emitting the fragment unstyled produces a
 * plausible-looking but completely unformatted document, so every consumer
 * that needs a *document* (PDF export, the dashboard canvas) has to gather
 * the CSS itself. Keeping that here means one module-graph walk instead of
 * one per consumer.
 *
 * NO ORDERING REQUIREMENT: Astro only populates the style modules in the
 * module graph during the first SSR evaluation of the entry. Rather than
 * make callers remember to render first, this function guarantees the entry
 * is loaded before walking the graph, so the result is correct whether or
 * not `renderTemplateToHtml` ran first. An earlier version returned an empty
 * list when called first, which was silently indistinguishable from a
 * template that genuinely has no CSS — and produced an unstyled document
 * with no error. That failure mode is gone.
 *
 * HONEST EMPTY RESULT: an empty list now means the entry compiled and
 * genuinely contributes no CSS. If the entry itself could not be compiled
 * into the graph, that is a real failure and is reported as a
 * `TemplateCompileError` rather than flattened into `[]`.
 */
export async function collectTemplateStyles(
  options: CollectTemplateStylesOptions,
): Promise<readonly TemplateStylesheet[]> {
  const entryPath = resolveEntryPath(options.templateRoot, options.entry ?? DEFAULT_STYLE_ENTRY);
  const server = await getServer(options.templateRoot);
  const { pluginContainer, moduleGraph } = server.vite;

  if (pluginContainer === undefined || moduleGraph === undefined) {
    throw new TemplateCompileError(
      'Vite dev server exposed no plugin container, so styles cannot be collected',
      { file: entryPath, line: null, column: null },
    );
  }

  // Astro keys module-graph entries by the resolved path (not the file URL)
  // that `loadTemplateEntry` requested, so resolve through Vite first.
  const resolved = await pluginContainer.resolveId(entryPath, undefined, { ssr: true });
  const rootId = resolved?.id ?? entryPath;

  // Guarantee the entry is evaluated so its style modules exist in the graph.
  // This is a no-op once a render has happened (Vite caches the module), so
  // the render-then-collect order costs nothing extra.
  if (moduleGraph.getModulesByFile(rootId) === undefined) {
    await loadTemplateEntry(options.templateRoot, options.entry ?? DEFAULT_STYLE_ENTRY);
  }

  const rootModules = moduleGraph.getModulesByFile(rootId);
  if (rootModules === undefined) {
    throw new TemplateCompileError(
      'Template entry compiled but produced no modules, so styles cannot be collected',
      { file: entryPath, line: null, column: null },
    );
  }

  // Walk the entry's component tree, following the component imports that
  // carry their own style blocks. Style modules themselves are terminal: an
  // Astro style module never imports another component.
  const visited = new Set<string>();
  const queue: string[] = [rootId];
  const styleIds: string[] = [];

  while (queue.length > 0) {
    const id = queue.shift()!;
    if (visited.has(id)) continue;
    visited.add(id);
    for (const module of moduleGraph.getModulesByFile(id) ?? []) {
      for (const imported of module.importedModules) {
        // Vite leaves `id` null for modules it cannot key; there is nothing
        // to resolve or load for those.
        if (imported.id === null) continue;
        if (ASTRO_STYLE_QUERY.test(imported.id)) {
          if (!styleIds.includes(imported.id)) styleIds.push(imported.id);
          continue;
        }
        if (imported.id.endsWith('.css')) continue;
        // Component ids carry query strings; normalise before queueing so the
        // visited set actually dedupes instead of growing unbounded.
        queue.push(imported.id.split('?')[0]!);
      }
    }
  }

  const stylesheets: TemplateStylesheet[] = [];
  for (const styleId of styleIds) {
    const content = await loadStylesheetContent(pluginContainer, styleId, rootId);
    if (content !== null) stylesheets.push({ id: styleId, content });
  }
  return stylesheets;
}

/** Fallback entry used only when a caller omits `entry`; mirrors render.ts. */
const DEFAULT_STYLE_ENTRY = 'src/Resume.astro';

/**
 * Load one compiled CSS module's text. Astro's style plugin returns the CSS
 * as the loaded module's `code`; anything else (or an empty string) means
 * that component contributed no stylesheet and is skipped.
 */
async function loadStylesheetContent(
  pluginContainer: NonNullable<TemplateServer['vite']['pluginContainer']>,
  styleId: string,
  importer: string,
): Promise<string | null> {
  try {
    const resolved = await pluginContainer.resolveId(styleId, importer, { ssr: false });
    const loaded = (await pluginContainer.load(
      resolved?.id ?? styleId,
      { ssr: false },
    )) as { code?: unknown } | null;
    const code = loaded?.code;
    return typeof code === 'string' && code.length > 0 ? code : null;
  } catch {
    // A component whose style module fails to load contributes no CSS; the
    // caller still gets every other sheet rather than a hard failure.
    return null;
  }
}

/**
 * Drop the cached server for one template root (or every root) so the next
 * render re-reads template source from disk. The studio's watcher calls this
 * when a template file changes.
 */
export async function invalidateTemplate(templateRoot?: string): Promise<void> {
  if (templateRoot === undefined) {
    const slots = Array.from(servers.values());
    servers.clear();
    await Promise.all(slots.map(closeSlot));
    return;
  }
  const slot = servers.get(templateRoot);
  if (slot === undefined) return;
  servers.delete(templateRoot);
  await closeSlot(slot);
}

async function closeSlot(slot: TemplateServerSlot): Promise<void> {
  try {
    const server = await slot.server;
    await server.vite.close();
  } catch {
    // Closing a server that never finished booting is no-op cleanup: the
    // original boot failure is already surfaced (or cached) by getServer.
  }
}

/** Number of cached template servers. Exposed for tests and diagnostics. */
export function cachedTemplateCount(): number {
  return servers.size;
}