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
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import process from 'node:process';

const fixtureRoot = fileURLToPath(new URL('./fixtures/workspace', import.meta.url));

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

beforeAll(() => {
  process.env['SEEVEE_WORKSPACE_ROOT'] = fixtureRoot;
  process.chdir(fixtureRoot);
});

afterAll(() => {
  delete process.env['SEEVEE_WORKSPACE_ROOT'];
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
    const res = await settle(mod.GET({} as Parameters<typeof mod.GET>[0]));
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toMatch(/text\/event-stream/);
    expect(res.headers.get('cache-control')).toBe('no-cache, no-transform');
    if (res.body !== null) {
      await res.body.cancel();
    }
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