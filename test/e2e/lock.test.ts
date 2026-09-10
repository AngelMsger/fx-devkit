import { spawn, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { afterEach, describe, expect, it } from 'vitest';

import { FileLock } from '../../src/infra/lock.js';
import { FileTrustStore } from '../../src/infra/trust-store.js';
import { FakeClock } from '../fakes/fake-clock.js';

const dirs: string[] = [];
const children: ChildProcess[] = [];
const lockModule = pathToFileURL(path.resolve('dist/infra/lock.js')).href;
const trustModule = pathToFileURL(path.resolve('dist/infra/trust-store.js')).href;
afterEach(async () => {
  for (const child of children.splice(0)) child.kill('SIGKILL');
  await Promise.all(dirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

async function home(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'fx-lock-process-'));
  dirs.push(dir);
  return dir;
}

function child(code: string): ChildProcess {
  const proc = spawn(process.execPath, ['--input-type=module', '-e', code], {
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  children.push(proc);
  return proc;
}

describe('leases between real processes', () => {
  it('keeps a live owner and recovers after that owner is killed', async () => {
    const dir = await home();
    const holder = child(`import { FileLock } from ${JSON.stringify(lockModule)};
      await new FileLock(${JSON.stringify(dir)}).acquire({key:'test',waitMs:0});
      process.stdout.write('held'); setInterval(()=>{},1000);`);
    await once(holder.stdout!, 'data');
    const lock = new FileLock(dir);
    expect(await lock.acquire({ key: 'test', waitMs: 0 })).toBeNull();
    const closed = once(holder, 'exit');
    holder.kill('SIGKILL');
    await closed;
    const recovered = await Promise.all(
      Array.from({ length: 6 }, () => lock.acquire({ key: 'test', waitMs: 0 })),
    );
    expect(recovered.filter(Boolean)).toHaveLength(1);
    await recovered.find(Boolean)?.release();
  });

  it('preserves approvals written by independent processes', async () => {
    const dir = await home();
    const completed = Array.from({ length: 4 }, (_, i) => {
      const proc = child(`import { FileLock } from ${JSON.stringify(lockModule)};
        import { FileTrustStore } from ${JSON.stringify(trustModule)};
        const store = new FileTrustStore(${JSON.stringify(dir)}, { now:()=>new Date() }, new FileLock(${JSON.stringify(dir)}));
        for(let j=0;j<8;j++) await store.trust('test', '${i}-'+j, 'test');`);
      return once(proc, 'exit');
    });
    expect((await Promise.all(completed)).map(([code]) => code)).toEqual([0, 0, 0, 0]);
    const store = new FileTrustStore(dir, new FakeClock(), new FileLock(dir));
    expect(await store.list('test')).toHaveLength(32);
  });
});
