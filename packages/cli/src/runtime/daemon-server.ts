/**
 * Seevee dashboard daemon — the detached server process entry point.
 *
 * This module is spawned by `./daemon.ts` and runs detached under the user's
 * session (not owned by the CLI terminal). It serves a minimal loopback-only
 * HTTP surface: `/api/health` plus a tiny landing page at `/`.
 *
 * Per `.dev/specs/CLI_INSTALLER.md` §7 the parent CLI never assumes spawn
 * means success — it polls `/api/health` until the workspace ID and server
 * version match before exiting. This module is what answers that poll.
 *
 * Usage (spawned, never run directly by the user):
 *   node daemon-server <workspace-root> <host> <port> <workspace-id>
 */

import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

export const DAEMON_VERSION = '0.1.0';

interface DaemonArgs {
  root: string;
  host: string;
  port: number;
  workspaceId: string;
}

function parseArgs(argv: readonly string[]): DaemonArgs | null {
  const [root, host, portRaw, workspaceId] = argv;
  if (!root || !host || !portRaw || !workspaceId) {
    return null;
  }
  const port = Number.parseInt(portRaw, 10);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    return null;
  }
  return { root, host, port, workspaceId };
}

function healthPayload(args: DaemonArgs): Record<string, unknown> {
  return {
    ok: true,
    workspaceId: args.workspaceId,
    serverVersion: DAEMON_VERSION,
    pid: process.pid,
    startedAt: new Date().toISOString(),
    host: args.host,
    port: args.port,
    root: args.root,
  };
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

async function readWorkspaceName(root: string): Promise<string> {
  try {
    const raw = await fs.readFile(path.join(root, 'seevee.json'), 'utf8');
    const parsed: unknown = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && 'name' in parsed) {
      const name = (parsed as Record<string, unknown>).name;
      if (typeof name === 'string' && name.length > 0) {
        return name;
      }
    }
  } catch {
    // fall through to basename fallback
  }
  return path.basename(root);
}

async function landingPage(args: DaemonArgs): Promise<string> {
  const name = await readWorkspaceName(args.root);
  return `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>Seevee — ${escapeHtml(name)}</title></head>
<body>
  <h1>Seevee workspace: ${escapeHtml(name)}</h1>
  <p>Dashboard server running on ${escapeHtml(args.host)}:${args.port}.</p>
  <p><a href="/api/health">health</a></p>
</body>
</html>`;
}

const args = parseArgs(process.argv.slice(2));
if (args === null) {
  process.stderr.write('daemon-server: usage: daemon-server <root> <host> <port> <workspace-id>\n');
  process.exit(1);
}

const server = http.createServer((req, res) => {
  const requestUrl = req.url ?? '/';
  const parsedUrl = new URL(requestUrl, `http://${args.host}:${args.port}`);
  if (parsedUrl.pathname === '/api/health') {
    res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(healthPayload(args)));
    return;
  }
  if (parsedUrl.pathname === '/') {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    void landingPage(args).then((body) => {
      res.end(body);
    });
    return;
  }
  res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
  res.end('not found');
});

server.listen(args.port, args.host, () => {
  process.stdout.write(`seevee-daemon listening on http://${args.host}:${args.port}\n`);
});
