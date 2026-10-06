import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { CodexAdapter } from '../src/adapters/codex.js';
import type { AdapterSession, CreateAdapterSessionOptions } from '../src/control/adapter.js';
import type { AgentEventInput } from '../src/control/types.js';
import { FakeOmpPeer } from './support/fake-acp-peer.js';

/**
 * Codex reports the real outcome of an interrupted turn on its own
 * `turn/completed` notification. `interrupt` must wait for that rather than
 * announcing a cancellation the provider has not confirmed.
 */

interface CodexHarness {
  peer: FakeOmpPeer;
  events: AgentEventInput[];
  session: AdapterSession;
  nextEvent(type: AgentEventInput['type']): Promise<AgentEventInput>;
}

const cleanups: (() => Promise<void>)[] = [];

afterEach(async () => {
  while (cleanups.length > 0) {
    const cleanup = cleanups.pop();
    if (cleanup !== undefined) await cleanup();
  }
});

async function drain(): Promise<void> {
  for (let i = 0; i < 4; i += 1) await new Promise<void>((resolve) => { setImmediate(resolve); });
}

async function createHarness(): Promise<CodexHarness> {
  const workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'seevee-codex-'));
  const binDir = await fs.mkdtemp(path.join(os.tmpdir(), 'seevee-codex-bin-'));
  const peer = await FakeOmpPeer.start({ dialect: 'codex' });
  const shim = await peer.writeShim(binDir);

  const events: AgentEventInput[] = [];
  const waiters: { type: AgentEventInput['type']; resolve: (event: AgentEventInput) => void }[] = [];
  const sessionOptions: CreateAdapterSessionOptions = {
    workspaceRoot,
    executablePath: shim,
    instructions: 'test instructions',
    env: peer.proxyEnv,
    emit: (event) => {
      events.push(event);
      for (const waiter of [...waiters]) {
        if (waiter.type !== event.type) continue;
        waiters.splice(waiters.indexOf(waiter), 1);
        waiter.resolve(event);
      }
    },
    signal: new AbortController().signal,
  };
  const session = await new CodexAdapter().createSession(sessionOptions);

  cleanups.push(async () => {
    await session.close();
    await peer.close();
    await fs.rm(workspaceRoot, { recursive: true, force: true });
    await fs.rm(binDir, { recursive: true, force: true });
  });

  return {
    peer,
    events,
    session,
    nextEvent: (type) => {
      const existing = events.find((event) => event.type === type);
      if (existing !== undefined) return Promise.resolve(existing);
      const { promise, resolve } = deferred<AgentEventInput>();
      waiters.push({ type, resolve });
      return promise;
    },
  };
}

function eventTypes(events: AgentEventInput[]): string[] {
  return events.map((event) => event.type);
}

describe('Codex interrupt', () => {
  it('does not report a cancellation before turn/completed confirms it', async () => {
    const harness = await createHarness();
    await harness.session.sendPrompt({ text: 'work', delivery: 'auto' });
    await harness.peer.waitForCall('turn/start');

    let settled = false;
    const interrupting = harness.session.interrupt().then(() => { settled = true; });
    await harness.peer.waitForCall('turn/interrupt');
    await drain();

    // `turn/interrupt` was accepted, but no terminal event has arrived.
    expect(settled).toBe(false);
    expect(eventTypes(harness.events)).not.toContain('turn.cancelled');

    harness.peer.completeTurn('interrupted');
    await interrupting;

    expect(eventTypes(harness.events)).toContain('turn.cancelled');
  });

  it('reports a failure when Codex ends the turn with an error', async () => {
    const harness = await createHarness();
    await harness.session.sendPrompt({ text: 'work', delivery: 'auto' });
    await harness.peer.waitForCall('turn/start');

    const interrupting = harness.session.interrupt();
    await harness.peer.waitForCall('turn/interrupt');
    harness.peer.completeTurn('failed');
    await interrupting;

    expect(eventTypes(harness.events)).toContain('turn.failed');
    expect(eventTypes(harness.events)).not.toContain('turn.cancelled');
  });

  it('is a no-op when no turn is running', async () => {
    const harness = await createHarness();
    await harness.session.interrupt();
    expect(harness.peer.called('turn/interrupt')).toBe(false);
    expect(eventTypes(harness.events)).not.toContain('turn.cancelled');
  });
});

/**
 * Minimal typed `Promise.withResolvers`, which the ES2022 lib in this package's
 * tsconfig does not declare. Node 20+ provides it at runtime.
 */
function deferred<T>(): { promise: Promise<T>; resolve: (value: T | PromiseLike<T>) => void } {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((res) => { resolve = res; });
  return { promise, resolve };
}