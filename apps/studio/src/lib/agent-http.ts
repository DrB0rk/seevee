import { AgentRuntimeError } from '@seevee/agent-runtime';

export function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
    },
  });
}

export function requireAgentMutation(request: Request): Response | null {
  const fetchSite = request.headers.get('sec-fetch-site');
  if (fetchSite === 'cross-site') return jsonResponse({ ok: false, reason: 'cross-site agent requests are rejected' }, 403);
  const origin = request.headers.get('origin');
  if (origin === null) return jsonResponse({ ok: false, reason: 'agent requests require a same-origin Origin header' }, 403);
  try {
    const originUrl = new URL(origin);
    const requestUrl = new URL(request.url);
    const host = request.headers.get('host') ?? requestUrl.host;
    const protocol = request.headers.get('x-forwarded-proto')?.split(',')[0]?.trim()
      ?? requestUrl.protocol.slice(0, -1);
    if (originUrl.origin !== new URL(`${protocol}://${host}`).origin) {
      return jsonResponse({ ok: false, reason: 'cross-origin agent requests are rejected' }, 403);
    }
  } catch {
    return jsonResponse({ ok: false, reason: 'invalid request origin' }, 403);
  }
  if (request.headers.get('x-seevee-agent') !== '1') {
    return jsonResponse({ ok: false, reason: 'missing agent request marker' }, 403);
  }
  return null;
}

export function agentErrorResponse(error: unknown): Response {
  if (error instanceof AgentRuntimeError) {
    const status = error.code === 'AGENT_SESSION_NOT_FOUND' ? 404 : 409;
    return jsonResponse({ ok: false, code: error.code, reason: error.message }, status);
  }
  return jsonResponse({
    ok: false,
    code: 'AGENT_OPERATION_FAILED',
    reason: error instanceof Error ? error.message : String(error),
  }, 500);
}
