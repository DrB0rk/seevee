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
import { agentRuntimeManager } from '../../lib/agent-runtime.js';
import type { WorkspaceEvent } from '../../lib/watcher.js';

export const prerender = false;

const HEARTBEAT_MS = 15_000;

export const GET: APIRoute = async ({ request }) => {
  const watcher = await workspaceWatcher();
  const manager = await agentRuntimeManager();
  const lastEventId = Number.parseInt(request.headers.get('last-event-id') ?? '0', 10);
  const encoder = new TextEncoder();

  let unsubscribe: (() => void) | null = null;
  let heartbeat: NodeJS.Timeout | null = null;
  let closed = false;

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const send = (event: WorkspaceEvent) => {
        if (closed) return;
        try {
          const id = event.type === 'agent.event' ? `id: ${event.event.seq}\n` : '';
          controller.enqueue(encoder.encode(`${id}data: ${JSON.stringify(event)}\n\n`));
        } catch {
          // controller already closed; tear down on next tick
          closed = true;
        }
      };
      unsubscribe = watcher.subscribe(send);
      const replayAfter = Number.isFinite(lastEventId) ? lastEventId : 0;
      for (const event of manager.snapshot().events) {
        if (event.seq > replayAfter) {
          send({ type: 'agent.event', event });
        }
      }
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