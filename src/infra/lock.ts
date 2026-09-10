// Cross-process leases live under FX_HOME. Publishing a complete owner record
// by exclusive hard link prevents a crash from leaving an ownerless lock.
// Reapers themselves hold leases, so competing stale recoveries cannot remove
// a newly acquired lock. Unreadable owners are conservatively left alone.

import { createHash, randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

import { asDevkitError } from '../domain/errors.js';
import type { Lease, Lock, LockRequest } from '../ports/lock.js';

interface Owner {
  readonly pid: number;
  readonly token: string;
}

export class FileLock implements Lock {
  constructor(private readonly home: string) {}

  async acquire(input: LockRequest): Promise<Lease | null> {
    const dir = path.join(this.home, 'locks');
    const file = path.join(dir, createHash('sha256').update(input.key).digest('hex'));
    try {
      await fs.mkdir(dir, { recursive: true, mode: 0o700 });
      const until = performance.now() + Math.max(0, input.waitMs);
      do {
        const lease = await claim(file, 0);
        if (lease !== null) return lease;
        const remaining = until - performance.now();
        if (remaining <= 0) return null;
        await delay(Math.min(20, remaining));
      } while (performance.now() <= until);
      return null;
    } catch (err) {
      throw asDevkitError(err);
    }
  }
}

async function claim(file: string, depth: number): Promise<Lease | null> {
  const owner: Owner = { pid: process.pid, token: randomUUID() };
  if (await publish(file, owner)) return leaseFor(file, owner);
  if (depth >= 8) return null;
  const old = await readOwner(file);
  if (old === undefined || isAlive(old.pid)) return null;
  const reaper = await claim(`${file}.reaper`, depth + 1);
  if (reaper === null) return null;
  try {
    const current = await readOwner(file);
    if (current?.token !== old.token || isAlive(current.pid)) return null;
    await fs.unlink(file);
    return (await publish(file, owner)) ? leaseFor(file, owner) : null;
  } finally {
    await reaper.release();
  }
}

async function publish(file: string, owner: Owner): Promise<boolean> {
  const candidate = `${file}.${owner.token}.candidate`;
  try {
    await fs.writeFile(candidate, JSON.stringify(owner), { flag: 'wx', mode: 0o600 });
    await fs.link(candidate, file);
    return true;
  } catch (err) {
    if (hasCode(err, 'EEXIST')) return false;
    throw asDevkitError(err);
  } finally {
    await fs.rm(candidate, { force: true });
  }
}

function leaseFor(file: string, owner: Owner): Lease {
  let released = false;
  return {
    async release(): Promise<void> {
      if (released) return;
      released = true;
      if ((await readOwner(file))?.token === owner.token) await fs.unlink(file);
    },
  };
}

async function readOwner(file: string): Promise<Owner | undefined> {
  try {
    const value: unknown = JSON.parse(await fs.readFile(file, 'utf8'));
    if (typeof value !== 'object' || value === null) return undefined;
    const owner = value as Partial<Owner>;
    if (
      !Number.isSafeInteger(owner.pid) ||
      (owner.pid ?? 0) <= 0 ||
      typeof owner.token !== 'string'
    )
      return undefined;
    return owner as Owner;
  } catch {
    return undefined;
  }
}

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return !hasCode(err, 'ESRCH');
  }
}

function hasCode(err: unknown, code: string): boolean {
  return typeof err === 'object' && err !== null && 'code' in err && err.code === code;
}
