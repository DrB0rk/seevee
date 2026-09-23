import { describe, expect, it } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { acquireStartLock } from '../src/runtime/start-lock.js';

describe('workspace daemon start lock', () => {
  it('allows only one owner at a time', async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'seevee-start-lock-'));
    const lockPath = path.join(directory, 'daemon-start.lock');
    try {
      const release = await acquireStartLock(lockPath);
      expect(release).toBeTypeOf('function');
      expect(await acquireStartLock(lockPath)).toBeNull();
      await release?.();
      const nextOwner = await acquireStartLock(lockPath);
      expect(nextOwner).toBeTypeOf('function');
      await nextOwner?.();
    } finally {
      await fs.rm(directory, { recursive: true, force: true });
    }
  });

  it('replaces a lock left by a process that has exited', async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'seevee-stale-lock-'));
    const lockPath = path.join(directory, 'daemon-start.lock');
    try {
      await fs.writeFile(lockPath, JSON.stringify({ pid: 2_147_483_647, token: 'stale' }));
      const release = await acquireStartLock(lockPath);
      expect(release).toBeTypeOf('function');
      await release?.();
    } finally {
      await fs.rm(directory, { recursive: true, force: true });
    }
  });
});
