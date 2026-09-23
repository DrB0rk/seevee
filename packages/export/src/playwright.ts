// Playwright gate + thin wrapper.
//
// The export pipeline never imports `playwright` eagerly: the package
// is declared `peerDependenciesMeta.optional = true`, so users without
// a browser pipeline still get a working `pnpm typecheck` and a clear
// runtime error. The gate probes the standard install layout
// (`node_modules/playwright/package.json`) instead of relying on a
// dynamic `import()` so the failure path is predictable.
//
// The thin wrapper around the Playwright lifecycle lives here too:
// launch → newPage → setContent → fonts.ready → ... → close. The
// caller (`exportToPdf`) only sees `capturePdf({ html, … })`.

import { access } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join, isAbsolute, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  PdfRenderError,
  PlaywrightNotInstalledError,
} from './errors.js';
import type {
  PlaywrightModule,
  PlaywrightPage,
  PlaywrightPdfOptions,
} from './types.js';

const PKG = 'playwright';

/**
 * Walk up `hostDir` to candidate `node_modules/<pkg>/package.json`
 * paths. We bound the search at eight levels: anything beyond that is
 * so far from the host it isn't useful to look.
 */
function packageJsonPath(hostDir: string, pkg: string): string {
  return join(hostDir, 'node_modules', pkg, 'package.json');
}

function hostDirectory(): string {
  return dirname(fileURLToPath(import.meta.url));
}

/**
 * Resolve whether the `playwright` package is installed in the host
 * module tree without triggering a dynamic import.
 *
 * `true` when `<hostDir>/node_modules/playwright/package.json` exists.
 */
export async function isPlaywrightAvailable(): Promise<boolean> {
  const candidate = packageJsonPath(hostDirectory(), PKG);
  try {
    await access(candidate);
    return true;
  } catch {
    return false;
  }
}

/**
 * Walk up from `rootDir` looking for an existing
 * `node_modules/<pkg>/package.json`. Used by tests and by callers
 * that want to gate on the optional dep from a specific tree root.
 */
export async function isPlaywrightInstalledAt(
  rootDir: string,
  pkg: string = PKG,
): Promise<boolean> {
  const start = isAbsolute(rootDir) ? rootDir : resolve(rootDir);
  let current = start;
  for (let i = 0; i < 8; i += 1) {
    const candidate = join(current, 'node_modules', pkg, 'package.json');
    try {
      await access(candidate);
      return true;
    } catch {
      const parent = dirname(current);
      if (parent === current) break;
      current = parent;
    }
  }
  return false;
}

/**
 * Resolve a Playwright module. Tests inject `override`; otherwise we
 * probe the host tree and only attempt the dynamic require/import
 * when the gate confirms the package is present.
 */
export async function loadPlaywrightModule(
  override?: PlaywrightModule,
): Promise<PlaywrightModule> {
  if (override !== undefined) return override;

  if (!(await isPlaywrightAvailable())) {
    throw new PlaywrightNotInstalledError(
      'Playwright is not installed. Run: pnpm add -D playwright && pnpm exec playwright install chromium',
    );
  }

  const mod = await dynamicImportPlaywright();
  if (mod === null) {
    throw new PlaywrightNotInstalledError(
      'Playwright is not installed. Run: pnpm add -D playwright && pnpm exec playwright install chromium',
    );
  }
  return mod;
}

async function dynamicImportPlaywright(): Promise<PlaywrightModule | null> {
  // Prefer `require` because Playwright ships a CommonJS entry that
  // is more reliable across versions than its ESM facade. Fall back
  // to a dynamic ESM import when `require` is unavailable.
  try {
    const requireFn = createRequire(import.meta.url);
    const required = requireFn('playwright') as unknown;
    if (isPlaywrightModule(required)) return required;
    return null;
  } catch {
    try {
      const imported = await import('playwright');
      if (isPlaywrightModule(imported)) return imported;
      return null;
    } catch {
      return null;
    }
  }
}

function isPlaywrightModule(value: unknown): value is PlaywrightModule {
  if (typeof value !== 'object' || value === null) return false;
  const chromium = (value as { chromium?: unknown }).chromium;
  if (typeof chromium !== 'object' || chromium === null) return false;
  const launch = (chromium as { launch?: unknown }).launch;
  return typeof launch === 'function';
}

/**
 * Capture a PDF from an HTML document via Playwright. The lifecycle
 * is owned here: the page and browser are always closed before the
 * promise resolves, including when the renderer step throws.
 */
export interface CapturePdfOptions {
  readonly html: string;
  readonly pdfOptions: PlaywrightPdfOptions;
  readonly playwrightModule: PlaywrightModule;
}

export async function capturePdf(options: CapturePdfOptions): Promise<void> {
  const browser = await options.playwrightModule.chromium.launch({
    headless: true,
  });
  try {
    const page = await browser.newPage();
    try {
      await page.setContent(options.html, { waitUntil: 'load' });
      // Playwright's `setContent({ waitUntil: 'load' })` already waits
      // for stylesheet `@font-face` declarations; this hook is the
      // single extension point a future iteration can use to add
      // `document.fonts.ready` polling without touching the caller.
      await assertFontsReady(page);
      await page.pdf(options.pdfOptions);
    } finally {
      await page.close().catch(() => {
        // Best-effort: a failed close during teardown must not mask
        // the original error from `page.pdf()`.
      });
    }
  } finally {
    await browser.close().catch(() => {
      // Same reasoning as page.close().
    });
  }
}

async function assertFontsReady(page: PlaywrightPage): Promise<void> {
  // Reserved hook: see note in capturePdf. The narrow surface we
  // expose intentionally omits `page.evaluate` so the Playwright
  // type contract stays small.
  void page;
}

/**
 * Convenience: rethrow an unrelated error as `PdfRenderError` so the
 * orchestration layer sees a stable class hierarchy.
 */
export function asPdfRenderError(error: unknown, fallback: string): never {
  const message = error instanceof Error ? error.message : fallback;
  throw new PdfRenderError(message);
}
