import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

import { isProcessAlive } from './process-state.js';

interface LockOwner {
  pid: number;
  token: string;
}

/** Acquire the workspace start lock, removing it only when its owner is gone. */
export async function acquireStartLock(lockPath: string): Promise<(() => Promise<void>) | null> {
  await fs.mkdir(path.dirname(lockPath), { recursive: true });
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const owner: LockOwner = { pid: process.pid, token: randomUUID() };
    const contents = JSON.stringify(owner);
    try {
      const handle = await fs.open(lockPath, 'wx');
      try {
        await handle.writeFile(contents, 'utf8');
      } catch (error) {
        await fs.unlink(lockPath).catch(() => {});
        throw error;
      } finally {
        await handle.close();
      }
      return async () => {
        try {
          if ((await fs.readFile(lockPath, 'utf8')) === contents) await fs.unlink(lockPath);
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
        }
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    }

    let existing = '';
    let lockAge = 0;
    let parsed: LockOwner | null = null;
    try {
      existing = await fs.readFile(lockPath, 'utf8');
      lockAge = Date.now() - (await fs.stat(lockPath)).mtimeMs;
      const value = JSON.parse(existing) as Partial<LockOwner>;
      if (Number.isInteger(value.pid) && typeof value.token === 'string') parsed = value as LockOwner;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue;
    }
    if (parsed && (await isProcessAlive(parsed.pid))) return null;
    if (!parsed && lockAge < 1000) return null;

    try {
      if ((await fs.readFile(lockPath, 'utf8')) === existing) await fs.unlink(lockPath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  }
  return null;
}
