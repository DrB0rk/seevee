/**
 * Workspace SSE broadcaster.
 *
 * Subscribes to filesystem changes inside the workspace using `fs.watch`
 * and re-broadcasts typed events to every connected client. Canonical
 * resources use atomic replace on disk, so the watcher debounces rapid
 * bursts on a single path and emits a single typed event per path. Each
 * path under `cvs/`, `presentations/`, `comments/`, `provenance/`, and
 * `sources/` maps to one of the typed events in §13 of
 * `DEVELOPMENT_PLAN.md`.
 *
 * The watcher is intentionally fire-and-forget. Any caller needing an
 * event for an out-of-band mutation (e.g. an agent run completing in
 * memory) can call `broadcast()` directly with the same payload shape.
 */
import fs from 'node:fs';
import path from 'node:path';

export type WorkspaceEvent =
  | { type: 'cv.updated'; cvId: string; revision: number; path: string }
  | { type: 'provenance.updated'; cvId: string; path: string }
  | { type: 'presentation.updated'; presentationId: string; path: string }
  | { type: 'comments.updated'; cvId: string; path: string }
  | { type: 'agent.run.started'; runId: string }
  | { type: 'agent.run.completed'; runId: string; state: string }
  | { type: 'template.build.started'; templateId: string }
  | { type: 'template.build.completed'; templateId: string }
  | { type: 'template.activated'; templateId: string }
  | { type: 'diagnostics.updated'; presentationId: string }
  | { type: 'export.completed'; exportId: string };

interface WatchKind {
  readonly dir: string;
  readonly map: (file: string) => WorkspaceEvent | null;
}

const WATCHED_KINDS: ReadonlyArray<WatchKind> = [
  {
    dir: 'cvs',
    map: (file) => ({
      type: 'cv.updated',
      cvId: file.replace(/\.json$/u, ''),
      // Caller can supply revision; the watcher emits 0 and clients
      // fetch the new revision through /api/cv/:id on receipt.
      revision: 0,
      path: `cvs/${file}`,
    }),
  },
  {
    dir: 'presentations',
    map: (file) => ({
      type: 'presentation.updated',
      presentationId: file.replace(/\.json$/u, ''),
      path: `presentations/${file}`,
    }),
  },
  {
    dir: 'comments',
    map: (file) => ({
      type: 'comments.updated',
      cvId: file.replace(/\.json$/u, ''),
      path: `comments/${file}`,
    }),
  },
  {
    dir: 'provenance',
    map: (file) => ({
      type: 'provenance.updated',
      cvId: file.replace(/\.json$/u, ''),
      path: `provenance/${file}`,
    }),
  },
];

interface Subscriber {
  send: (event: WorkspaceEvent) => void;
}

export class WorkspaceWatcher {
  private readonly subscribers = new Set<Subscriber>();
  private readonly handles: fs.FSWatcher[] = [];
  private readonly debounce = new Map<string, NodeJS.Timeout>();
  private readonly pending = new Map<string, WorkspaceEvent>();
  private started = false;

  constructor(private readonly root: string) {}

  start(): void {
    if (this.started) return;
    // fs.watch is recursive on macOS/Windows but not Linux; we watch
    // each known subdirectory individually so behaviour is consistent.
    for (const kind of WATCHED_KINDS) {
      const dir = path.join(this.root, kind.dir);
      try {
        const handle = fs.watch(dir, { persistent: false }, (_event, filename) => {
          if (typeof filename !== 'string') return;
          if (!filename.endsWith('.json')) return;
          const mapped = kind.map(filename);
          if (mapped === null) return;
          this.scheduleEmit(mapped);
        });
        handle.on('error', () => {
          // The directory may not exist yet; ignore the error and rely
          // on the next caller's path-resolution to surface it.
          handle.close();
        });
        this.handles.push(handle);
      } catch {
        // directory missing — leave unobserved until the workspace grows.
      }
    }
    this.started = true;
  }

  stop(): void {
    for (const handle of this.handles) {
      try {
        handle.close();
      } catch {
        // best effort
      }
    }
    this.handles.length = 0;
    this.started = false;
    for (const timer of this.debounce.values()) clearTimeout(timer);
    this.debounce.clear();
    this.pending.clear();
  }

  subscribe(send: (event: WorkspaceEvent) => void): () => void {
    const sub: Subscriber = { send };
    this.subscribers.add(sub);
    return () => {
      this.subscribers.delete(sub);
    };
  }

  broadcast(event: WorkspaceEvent): void {
    for (const sub of this.subscribers) {
      try {
        sub.send(event);
      } catch {
        // Subscriber dropped; remove it.
        this.subscribers.delete(sub);
      }
    }
  }

  private scheduleEmit(event: WorkspaceEvent): void {
    const key = event.type + ':' + (event as { path?: string }).path;
    this.pending.set(key, event);
    const existing = this.debounce.get(key);
    if (existing !== undefined) clearTimeout(existing);
    const timer = setTimeout(() => {
      const payload = this.pending.get(key);
      this.pending.delete(key);
      this.debounce.delete(key);
      if (payload !== undefined) this.broadcast(payload);
    }, 50);
    this.debounce.set(key, timer);
  }
}