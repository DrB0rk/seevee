/**
 * GET /api/events — Server-Sent Events stream.
 *
 * Long-lived response that emits one `data:` frame per workspace event.
 * Subscribers are registered with the shared `WorkspaceWatcher`; the
 * watcher debounces filesystem noise and forwards typed events for every
 * changed resource under `cvs/`, `presentations/`, `comments/`,
 * `provenance/`, and `sources/`.
 *
 * The stream is flushed on every event and emits a 15s heartbeat so
 * reverse proxies don't close idle connections.
 */
import type { APIRoute } from 'astro';
import { workspaceWatcher } from '../../lib/runtime.js';
import type { WorkspaceEvent } from '../../lib/watcher.js';

export const prerender = false;

const HEARTBEAT_MS = 15_000;

export const GET: APIRoute = async () => {
  const watcher = await workspaceWatcher();
  const encoder = new TextEncoder();

  let unsubscribe: (() => void) | null = null;
  let heartbeat: NodeJS.Timeout | null = null;
  let closed = false;

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const send = (event: WorkspaceEvent) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
        } catch {
          // controller already closed; tear down on next tick
          closed = true;
        }
      };
      unsubscribe = watcher.subscribe(send);
      heartbeat = setInterval(() => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(`: keep-alive ${Date.now()}\n\n`));
        } catch {
          closed = true;
        }
      }, HEARTBEAT_MS);

      // Initial comment so EventSource knows the connection is open.
      controller.enqueue(encoder.encode(`: seevee events open\n\n`));
    },
    cancel() {
      closed = true;
      if (unsubscribe !== null) unsubscribe();
      if (heartbeat !== null) clearInterval(heartbeat);
    },
  });

  return new Response(stream, {
    status: 200,
    headers: {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
      'x-accel-buffering': 'no',
    },
  });
};