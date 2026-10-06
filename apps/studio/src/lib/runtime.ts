/**
 * Runtime singleton — one workspace watcher per Astro server process.
 *
 * Astro creates a fresh module graph per request inside the dev server,
 * but production runs a single Node process. We use `globalThis` to keep
 * a single watcher alive across HMR reloads and to avoid re-watching the
 * filesystem on every request to /api/events.
 */
import path from 'node:path';
import { loadWorkspaceContext } from './workspace.js';
import { invalidateTemplateVersion } from './renderer.js';
import { WorkspaceWatcher } from './watcher.js';

interface RuntimeSlot {
  watcher: WorkspaceWatcher | null;
  initPromise: Promise<WorkspaceWatcher> | null;
}

const RUNTIME_KEY = Symbol.for('@seevee/studio/runtime-slot');

type GlobalWithSlot = typeof globalThis & {
  [RUNTIME_KEY]?: RuntimeSlot;
};

function getSlot(): RuntimeSlot {
  const g = globalThis as GlobalWithSlot;
  if (g[RUNTIME_KEY] === undefined) {
    g[RUNTIME_KEY] = { watcher: null, initPromise: null };
  }
  return g[RUNTIME_KEY];
}

export async function workspaceWatcher(): Promise<WorkspaceWatcher> {
  const slot = getSlot();
  if (slot.watcher !== null) return slot.watcher;
  if (slot.initPromise === null) {
    slot.initPromise = (async () => {
      const ctx = await loadWorkspaceContext();
      const watcher = new WorkspaceWatcher(ctx.root);
      // Template renders are cached per version root. A source edit has to drop
      // that cache or the next preview request keeps serving the stale compile,
      // so the watcher event is what makes live editing of a template real.
      watcher.subscribe((event) => {
        if (event.type !== 'template.updated') return;
        const root = path.resolve(ctx.root, event.relativePath);
        void invalidateTemplateVersion(root).catch(() => {
          // Cache invalidation is best-effort: a failure here must not take
          // down the event stream. The next render retries a fresh boot.
        });
      });
      watcher.start();
      slot.watcher = watcher;
      return watcher;
    })();
  }
  return slot.initPromise;
}