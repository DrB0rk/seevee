import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { OmpAdapter, OmpProtocolError, ompAcpModeForPermission, ompPermissionMode, OMP_ACP_MODES, OMP_PERMISSION_MODES } from '../src/adapters/omp.js';
import type { AdapterSession, CreateAdapterSessionOptions } from '../src/control/adapter.js';
import type { AgentEventInput } from '../src/control/types.js';
import { FakeOmpPeer } from './support/fake-acp-peer.js';

/**
 * These drive the real `OmpAdapter` over a scripted ACP peer on real stdio, so
 * every assertion is about the bytes the adapter actually sends.
 *
 * Protocol facts encoded by the peer were verified against omp 18.6.1:
 * `session/set_mode` accepts only `default` and `plan`, and the only ACP config
 * options are `mode`, `model` and `thinking`. OMP exposes no server-side
 * permission mode, so permissions are enforced by the adapter client-side.
 */

interface OmpHarness {
  peer: FakeOmpPeer;
  events: AgentEventInput[];
  workspaceRoot: string;
  session: AdapterSession;
  /** Resolves on the adapter's next emitted event of `type`. */
  nextEvent(type: AgentEventInput['type']): Promise<AgentEventInput>;
}

/**
 * Minimal typed `Promise.withResolvers`, which the ES2022 lib in this package's
 * tsconfig does not declare. Node 20+ provides it at runtime.
 */
function deferred<T>(): { promise: Promise<T>; resolve: (value: T | PromiseLike<T>) => void } {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((res) => { resolve = res; });
  return { promise, resolve };
}

const cleanups: (() => Promise<void>)[] = [];

afterEach(async () => {
  while (cleanups.length > 0) {
    const cleanup = cleanups.pop();
    if (cleanup !== undefined) await cleanup();
  }
});

/** Lets queued I/O and microtasks drain without asserting on elapsed time. */
async function drain(): Promise<void> {
  for (let i = 0; i < 4; i += 1) await new Promise<void>((resolve) => { setImmediate(resolve); });
}

/**
 * Starts a fake ACP peer and runs the real `OmpAdapter` against it over the
 * adapter's own process pipe, so assertions see the adapter's wire traffic.
 */
async function createHarness(options: { modeIds?: readonly string[] } = {}): Promise<OmpHarness> {
  const workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'seevee-omp-'));
  const binDir = await fs.mkdtemp(path.join(os.tmpdir(), 'seevee-omp-bin-'));
  const peer = await FakeOmpPeer.start(
    options.modeIds === undefined ? {} : { allowedModeIds: options.modeIds },
  );
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
  const session = await new OmpAdapter().createSession(sessionOptions);

  cleanups.push(async () => {
    await session.close();
    await peer.close();
    await fs.rm(workspaceRoot, { recursive: true, force: true });
    await fs.rm(binDir, { recursive: true, force: true });
  });

  return {
    peer,
    events,
    workspaceRoot,
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

function firstEvent(events: AgentEventInput[], type: AgentEventInput['type']): AgentEventInput | undefined {
  return events.find((event) => event.type === type);
}

describe('OMP permission vocabulary', () => {
  it('offers only modes OMP can express', () => {
    expect([...OMP_PERMISSION_MODES]).toEqual(['ask', 'plan', 'full']);
    expect([...OMP_ACP_MODES]).toEqual(['default', 'plan']);
    expect(ompPermissionMode('full')).toBe('full');
    expect(ompPermissionMode('bypassPermissions')).toBeNull();
  });

  it('maps Full access onto a valid ACP mode rather than a "full" ACP mode', () => {
    // `session/set_mode('full')` is rejected by the provider. `full` is a
    // client-side policy riding on the valid `default` ACP mode.
    expect(ompAcpModeForPermission('full')).toBe('default');
    expect(ompAcpModeForPermission('ask')).toBe('default');
    expect(ompAcpModeForPermission('plan')).toBe('plan');
  });
});

describe('OMP updateConfig', () => {
  it('never sends a mode id OMP rejects', async () => {
    const harness = await createHarness();
    const { peer, session } = harness;

    await session.updateConfig({ permissionMode: 'full' });
    await session.updateConfig({ permissionMode: 'ask' });
    await session.updateConfig({ permissionMode: 'plan' });
    await drain();

    const modeIds = peer.received
      .filter((entry) => entry.method === 'session/set_mode')
      .map((entry) => String(entry.params?.['modeId']));
    expect(modeIds).not.toContain('full');
    expect(modeIds).not.toContain('yolo');
    expect(modeIds).not.toContain('bypassPermissions');
    expect(modeIds.every((id) => id === 'default' || id === 'plan')).toBe(true);
    // Nothing OMP would answer with "Unsupported ACP mode".
    expect(peer.responses.filter((entry) => entry.error !== undefined)).toHaveLength(0);
  });

  it('keeps permissionMode full so the picker reflects the selection', async () => {
    const harness = await createHarness();
    expect((await harness.session.getConfiguration()).permissionMode).toBe('ask');

    await harness.session.updateConfig({ permissionMode: 'full' });

    expect((await harness.session.getConfiguration()).permissionMode).toBe('full');
    expect(firstEvent(harness.events, 'session.state')?.data).toMatchObject({ permissionMode: 'full' });
  });

  it('switches OMP into plan mode only for the plan permission mode', async () => {
    const harness = await createHarness();
    await harness.session.updateConfig({ permissionMode: 'plan' });
    expect(harness.peer.paramsFor('session/set_mode')).toMatchObject({ modeId: 'plan' });
    expect((await harness.session.getConfiguration()).permissionMode).toBe('plan');
  });

  it('rejects an unknown permission mode with an actionable error', async () => {
    const harness = await createHarness();
    const failure = await harness.session.updateConfig({ permissionMode: 'yolo' }).catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(OmpProtocolError);
    expect((failure as Error).message).toMatch(/known permission modes are ask, plan, full/);
    // The rejected selection must not look like it took.
    expect((await harness.session.getConfiguration()).permissionMode).toBe('ask');
  });

  it('surfaces a provider rejection as a typed error carrying the provider wording', async () => {
    // A peer accepting only `default` rejects the `plan` mapping, standing in
    // for a provider build without that mode.
    const harness = await createHarness({ modeIds: ['default'] });
    const failure = await harness.session.updateConfig({ permissionMode: 'plan' }).catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(OmpProtocolError);
    expect((failure as Error).message).toContain('Unsupported ACP mode: plan');
    expect((failure as Error).message).not.toBe('Internal error');
    expect((await harness.session.getConfiguration()).permissionMode).toBe('ask');
  });
});

describe('OMP permission enforcement', () => {
  const permissionRequest = {
    sessionId: 'omp-fake-session',
    toolCall: { toolCallId: 'call-1', title: 'ls -la', kind: 'execute', status: 'pending' },
    options: [
      { optionId: 'allow_once', name: 'Allow once', kind: 'allow_once' },
      { optionId: 'allow_always', name: 'Always allow', kind: 'allow_always' },
      { optionId: 'reject_once', name: 'Reject', kind: 'reject_once' },
    ],
  };

  it('auto-approves session/request_permission in Full access', async () => {
    const harness = await createHarness();
    await harness.session.updateConfig({ permissionMode: 'full' });

    const requestId = harness.peer.pushRequest('session/request_permission', permissionRequest);
    const response = await harness.peer.waitForResponse(requestId);

    expect(response.result).toEqual({ outcome: { outcome: 'selected', optionId: 'allow_always' } });
    expect(eventTypes(harness.events)).not.toContain('approval.requested');
  });

  it('falls back to allow_once when the provider offers no always-allow option', async () => {
    const harness = await createHarness();
    await harness.session.updateConfig({ permissionMode: 'full' });

    const requestId = harness.peer.pushRequest('session/request_permission', {
      ...permissionRequest,
      options: [
        { optionId: 'allow_once', kind: 'allow_once' },
        { optionId: 'reject_once', kind: 'reject_once' },
      ],
    });
    const response = await harness.peer.waitForResponse(requestId);

    expect(response.result).toEqual({ outcome: { outcome: 'selected', optionId: 'allow_once' } });
  });

  it('still asks the user in ask mode and applies the decision', async () => {
    const harness = await createHarness();

    const requestId = harness.peer.pushRequest('session/request_permission', permissionRequest);
    const approval = await harness.nextEvent('approval.requested');

    expect(approval.approvalId).not.toBeNull();
    // Nothing is sent until the user decides.
    expect(harness.peer.responseFor(requestId)).toBeUndefined();

    await harness.session.resolveApproval(String(approval.approvalId), { decision: 'allow-once' });
    const response = await harness.peer.waitForResponse(requestId);
    expect(response.result).toEqual({ outcome: { outcome: 'selected', optionId: 'allow_once' } });
  });

  it('denies a permission request the user rejects', async () => {
    const harness = await createHarness();
    const requestId = harness.peer.pushRequest('session/request_permission', permissionRequest);
    const approval = await harness.nextEvent('approval.requested');

    await harness.session.resolveApproval(String(approval.approvalId), { decision: 'deny' });
    const response = await harness.peer.waitForResponse(requestId);
    expect(response.result).toEqual({ outcome: { outcome: 'selected', optionId: 'reject_once' } });
  });

  it('performs a workspace write in Full access without asking', async () => {
    const harness = await createHarness();
    await harness.session.updateConfig({ permissionMode: 'full' });

    const requestId = harness.peer.pushRequest('fs/write_text_file', {
      sessionId: 'omp-fake-session',
      path: path.join(harness.workspaceRoot, 'auto.txt'),
      content: 'granted',
    });
    const response = await harness.peer.waitForResponse(requestId);

    expect(response.error).toBeUndefined();
    await expect(fs.readFile(path.join(harness.workspaceRoot, 'auto.txt'), 'utf8')).resolves.toBe('granted');
    expect(eventTypes(harness.events)).not.toContain('approval.requested');
  });

  it('asks before a workspace write in ask mode and applies it on approval', async () => {
    const harness = await createHarness();
    const target = path.join(harness.workspaceRoot, 'asked.txt');

    harness.peer.pushRequest('fs/write_text_file', {
      sessionId: 'omp-fake-session',
      path: target,
      content: 'approved content',
    });
    const approval = await harness.nextEvent('approval.requested');

    expect(approval.data).toMatchObject({ kind: 'fs/write_text_file' });
    await expect(fs.readFile(target, 'utf8')).rejects.toThrow();

    await harness.session.resolveApproval(String(approval.approvalId), { decision: 'allow-once' });
    await expect(fs.readFile(target, 'utf8')).resolves.toBe('approved content');
  });

  it('denies the write when the user rejects it', async () => {
    const harness = await createHarness();
    const target = path.join(harness.workspaceRoot, 'denied.txt');

    const requestId = harness.peer.pushRequest('fs/write_text_file', {
      sessionId: 'omp-fake-session',
      path: target,
      content: 'nope',
    });
    const approval = await harness.nextEvent('approval.requested');

    await harness.session.resolveApproval(String(approval.approvalId), { decision: 'deny' });
    const response = await harness.peer.waitForResponse(requestId);

    await expect(fs.readFile(target, 'utf8')).rejects.toThrow();
    expect(response.error?.message).toMatch(/denied/i);
  });

  it('refuses a write that escapes the workspace root even in Full access', async () => {
    const harness = await createHarness();
    await harness.session.updateConfig({ permissionMode: 'full' });

    const requestId = harness.peer.pushRequest('fs/write_text_file', {
      sessionId: 'omp-fake-session',
      path: path.join(os.tmpdir(), 'seevee-escape.txt'),
      content: 'escaped',
    });
    const response = await harness.peer.waitForResponse(requestId);

    expect(response.error?.message).toMatch(/outside the workspace/);
  });
});

describe('OMP interrupt', () => {
  it('does not report a cancellation before OMP confirms it', async () => {
    const harness = await createHarness();
    harness.peer.ignoreCancel = true;

    await harness.session.sendPrompt({ text: 'do the thing', delivery: 'auto' });
    await harness.peer.waitForCall('session/prompt');

    let settled = false;
    const interrupting = harness.session.interrupt().then(() => { settled = true; });
    await harness.peer.waitForCall('session/cancel');
    await drain();

    // The notification went out, but the provider has not resolved the
    // in-flight prompt, so nothing may claim the turn ended.
    expect(settled).toBe(false);
    expect(eventTypes(harness.events)).not.toContain('turn.cancelled');

    harness.peer.releaseCancel();
    await interrupting;

    const cancellations = harness.events.filter((event) => event.type === 'turn.cancelled');
    expect(cancellations).toHaveLength(1);
    expect(cancellations[0]?.data).toMatchObject({ stopReason: 'cancelled' });
  });

  it('reports a completion, not a cancellation, when OMP ignores the cancel', async () => {
    const harness = await createHarness();
    harness.peer.ignoreCancel = true;

    await harness.session.sendPrompt({ text: 'keep going', delivery: 'auto' });
    await harness.peer.waitForCall('session/prompt');

    const interrupting = harness.session.interrupt();
    await harness.peer.waitForCall('session/cancel');
    await drain();
    expect(eventTypes(harness.events)).not.toContain('turn.cancelled');

    // The provider finishes the turn normally despite the cancel.
    harness.peer.finishNormal();
    await interrupting;

    expect(eventTypes(harness.events)).toContain('turn.completed');
    expect(eventTypes(harness.events)).not.toContain('turn.cancelled');
  });

  it('is a no-op when no turn is running', async () => {
    const harness = await createHarness();
    await harness.session.interrupt();
    expect(harness.peer.called('session/cancel')).toBe(false);
    expect(eventTypes(harness.events)).not.toContain('turn.cancelled');
  });
});