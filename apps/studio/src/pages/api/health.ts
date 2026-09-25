/**
 * GET /api/health — workspace-aware health probe.
 *
 * Returns the running server's identity plus the workspace it has bound to.
 * The CLI's daemon polls this endpoint to confirm the dashboard is live
 * and serves the same `workspaceId` it started with (see
 * `.dev/specs/CLI_INSTALLER.md` §7 and the matching contract in
 * `packages/cli/src/runtime/daemon.ts`).
 *
 * The body is intentionally small and free of any secrets; the server
 * version is `appVersion` not the schema version so it is safe to log.
 */
import type { APIRoute } from 'astro';
import { loadWorkspaceContext, NoWorkspaceError } from '../../lib/workspace.js';

export const prerender = false;

const APP_VERSION = process.env.SEEVEE_VERSION ?? '0.1.0-alpha.10';

interface HealthPayload {
  ok: true;
  workspaceId: string | null;
  serverVersion: string;
  pid: number;
  startedAt: string;
}

const startedAt = new Date().toISOString();

export const GET: APIRoute = async () => {
  let workspaceId: string | null = null;
  try {
    const ctx = await loadWorkspaceContext();
    workspaceId = ctx.workspace.id;
  } catch (err) {
    if (!(err instanceof NoWorkspaceError)) throw err;
    // No workspace yet — return null but keep ok=true so the CLI can
    // distinguish a not-yet-ready dashboard from a crashed one.
  }

  const body: HealthPayload = {
    ok: true,
    workspaceId,
    serverVersion: APP_VERSION,
    pid: process.pid,
    startedAt,
  };

  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
};
