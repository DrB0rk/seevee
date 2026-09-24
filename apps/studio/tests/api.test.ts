/**
 * API smoke tests for the Seevee Studio.
 *
 * Exercises the public API surface the dashboard relies on by importing
 * each route's `GET`/`POST` export and invoking it with a synthetic
 * `Request`-shaped context. The fixture workspace is bound by setting
 * `SEEVEE_WORKSPACE_ROOT` and chdir so the workspace library resolves.
 *
 * The tests do NOT start a real Astro server. Astro's standalone Node
 * adapter requires `astro build`, which is exercised separately.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import process from 'node:process';

const fixtureRoot = fileURLToPath(new URL('./fixtures/workspace', import.meta.url));
let testRoot = '';
let previousCwd = '';

interface HealthBody {
  ok: boolean;
  workspaceId: string | null;
  serverVersion: string;
  pid: number;
  startedAt: string;
}

interface CvListItem {
  ok: boolean;
  cv?: {
    id: string;
    revision: number;
    updatedAt: string;
    name: string;
    headline: string | null;
    locale: string;
    sectionCount: number;
  };
  path?: string;
  status?: number;
  reason?: string;
}

type RouteReturn<T> = T | Promise<T>;

async function settle<T>(value: RouteReturn<T>): Promise<T> {
  return value instanceof Promise ? value : Promise.resolve(value);
}

beforeAll(async () => {
  previousCwd = process.cwd();
  testRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'seevee-studio-test-'));
  await fs.cp(fixtureRoot, testRoot, { recursive: true });
  process.env['SEEVEE_WORKSPACE_ROOT'] = testRoot;
  process.chdir(testRoot);
});

afterAll(async () => {
  delete process.env['SEEVEE_WORKSPACE_ROOT'];
  process.chdir(previousCwd);
  await fs.rm(testRoot, { recursive: true, force: true });
});

describe('Studio API', () => {
  it('returns server identity from /api/health', async () => {
    const mod = await import('../src/pages/api/health.js');
    const res = await settle(mod.GET({} as Parameters<typeof mod.GET>[0]));
    expect(res).toBeInstanceOf(Response);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toMatch(/application\/json/);
    const body = (await res.json()) as HealthBody;
    expect(body.ok).toBe(true);
    expect(body.workspaceId).toBe('ws_test');
    expect(typeof body.serverVersion).toBe('string');
    expect(typeof body.pid).toBe('number');
    expect(typeof body.startedAt).toBe('string');
  });

  it('lists CVs through /api/cv', async () => {
    const mod = await import('../src/pages/api/cv/index.js');
    const res = await settle(mod.GET({} as Parameters<typeof mod.GET>[0]));
    expect(res.status).toBe(200);
    const items = (await res.json()) as CvListItem[];
    expect(items.length).toBe(1);
    const only = items[0]!;
    expect(only.ok).toBe(true);
    if (only.ok) {
      expect(only.cv.id).toBe('cv_test');
      expect(only.cv.name).toBe('Ada Lovelace');
      expect(only.cv.headline).toBe('Mathematician');
      expect(only.cv.sectionCount).toBe(2);
    }
  });

  it('returns a single CV document from /api/cv/:id', async () => {
    const mod = await import('../src/pages/api/cv/[id].js');
    const res = await settle(
      mod.GET({ params: { id: 'cv_test' } } as Parameters<typeof mod.GET>[0]),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; document?: { id: string } };
    expect(body.ok).toBe(true);
    expect(body.document?.id).toBe('cv_test');
  });

  it('saves a schema-valid CV with revision protection', async () => {
    const mod = await import('../src/pages/api/cv/[id].js');
    const get = await import('../src/pages/api/cv/[id].js');
    const loaded = await settle(get.GET({ params: { id: 'cv_test' } } as Parameters<typeof get.GET>[0]));
    const current = await loaded.json() as { document: Record<string, any> };
    current.document.data.identity.name.display = 'Grace Hopper';
    const request = new Request('http://127.0.0.1:43129/api/cv/cv_test', {
      method: 'PUT',
      headers: { 'content-type': 'application/json', origin: 'http://localhost:43129', host: 'localhost:43129' },
      body: JSON.stringify({ expectedRevision: 1, document: current.document }),
    });
    const saved = await settle(mod.PUT({ params: { id: 'cv_test' }, request } as Parameters<typeof mod.PUT>[0]));
    expect(saved.status).toBe(200);
    const body = await saved.json() as { ok: boolean; document: { revision: number; data: { identity: { name: { display: string } } } } };
    expect(body.ok).toBe(true);
    expect(body.document.revision).toBe(2);
    expect(body.document.data.identity.name.display).toBe('Grace Hopper');

    const crossOriginRequest = new Request('http://127.0.0.1:43129/api/cv/cv_test', {
      method: 'PUT',
      headers: { 'content-type': 'application/json', origin: 'http://attacker.invalid', host: 'localhost:43129' },
      body: JSON.stringify({ expectedRevision: 2, document: body.document }),
    });
    const crossOrigin = await settle(mod.PUT({ params: { id: 'cv_test' }, request: crossOriginRequest } as Parameters<typeof mod.PUT>[0]));
    expect(crossOrigin.status).toBe(403);

    const staleRequest = new Request('http://localhost/api/cv/cv_test', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ expectedRevision: 1, document: current.document }),
    });
    const stale = await settle(mod.PUT({ params: { id: 'cv_test' }, request: staleRequest } as Parameters<typeof mod.PUT>[0]));
    expect(stale.status).toBe(409);
  });

  it('returns 404 for an unknown CV', async () => {
    const mod = await import('../src/pages/api/cv/[id].js');
    const res = await settle(
      mod.GET({ params: { id: 'cv_does_not_exist' } } as Parameters<typeof mod.GET>[0]),
    );
    expect(res.status).toBe(404);
  });

  it('lists presentations through /api/presentation', async () => {
    const mod = await import('../src/pages/api/presentation/index.js');
    const res = await settle(mod.GET({} as Parameters<typeof mod.GET>[0]));
    expect(res.status).toBe(200);
    const items = (await res.json()) as Array<{ ok: boolean; presentation?: { id: string } }>;
    expect(items.length).toBe(1);
    const only = items[0]!;
    expect(only.ok).toBe(true);
    expect(only.presentation?.id).toBe('pres_test');
  });

  it('exposes the SSE handshake headers at /api/events', async () => {
    const mod = await import('../src/pages/api/events.js');
    const request = new Request('http://localhost/api/events');
    const res = await settle(mod.GET({ request } as Parameters<typeof mod.GET>[0]));
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toMatch(/text\/event-stream/);
    expect(res.headers.get('cache-control')).toBe('no-cache, no-transform');
    if (res.body !== null) {
      await res.body.cancel();
    }
  });

  it('lists local agent providers through the central control plane', async () => {
    // Deferred import keeps workspace root discovery after beforeAll installs the fixture root.
    const mod = await import('../src/pages/api/agents/index.js');
    const res = await settle(mod.GET({ url: new URL('http://localhost/api/agents') } as Parameters<typeof mod.GET>[0]));
    const body = await res.json() as {
      ok: boolean;
      snapshot: { providers: Array<{ id: string; installed: boolean; capabilities: Record<string, boolean> }> };
      savedSessions: unknown[];
    };
    expect(body.ok).toBe(true);
    expect(body.snapshot.providers.map((provider) => provider.id).sort()).toEqual(['claude-code', 'codex', 'omp']);
    expect(Array.isArray(body.savedSessions)).toBe(true);
    for (const provider of body.snapshot.providers) {
      expect(typeof provider.installed).toBe('boolean');
      expect(provider.capabilities['toolCalls']).toBe(true);
    }
  });

  it('rejects agent mutations without same-origin markers', async () => {
    // Deferred import keeps workspace discovery bound to the test fixture.
    const mod = await import('../src/pages/api/agents/session.js');
    const request = new Request('http://localhost/api/agents/session', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ provider: 'codex' }),
    });
    const res = await settle(mod.POST({ request } as Parameters<typeof mod.POST>[0]));
    expect(res.status).toBe(403);
  });

  it('rejects cross-origin agent mutations', async () => {
    const mod = await import('../src/pages/api/agents/session.js');
    const request = new Request('http://localhost/api/agents/session', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'host': 'localhost',
        'origin': 'http://attacker.invalid',
        'x-seevee-agent': '1',
      },
      body: JSON.stringify({ provider: 'codex' }),
    });
    const res = await settle(mod.POST({ request } as Parameters<typeof mod.POST>[0]));
    expect(res.status).toBe(403);
  });
});

describe('fixture workspace', () => {
  it('contains seevee.json', async () => {
    const fs = await import('node:fs/promises');
    const stat = await fs.stat(path.join(fixtureRoot, 'seevee.json'));
    expect(stat.isFile()).toBe(true);
  });

  it('contains a CV document', async () => {
    const fs = await import('node:fs/promises');
    const stat = await fs.stat(path.join(fixtureRoot, 'cvs/cv_test.json'));
    expect(stat.isFile()).toBe(true);
  });
});
