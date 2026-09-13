import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

import { describe, expect, it } from 'vitest';

import { NodeLifecycleRunner } from '../../../src/adapters/process/lifecycle-runner.js';

describe('independent lifecycle supervision', () => {
  it('reports bounded worker failures and timeouts without leaking worker text', async () => {
    const reasons: string[] = [];
    const diagnosed = new NodeLifecycleRunner((reason) => reasons.push(reason));
    expect(
      await diagnosed.run({
        vector: [
          process.execPath,
          '-e',
          "process.send({kind:'failure', secret:'private-value'});setInterval(()=>{},1000)",
        ],
        input: Promise.resolve('{}'),
        timeoutMs: 2000,
      }),
    ).toBe('');
    expect(
      await diagnosed.run({
        vector: [process.execPath, '-e', 'while(true) {}'],
        input: Promise.resolve('{}'),
        timeoutMs: 100,
      }),
    ).toBe('');
    expect(reasons).toEqual(['HOOK_WORKER_FAILED', 'HOOK_TIMEOUT']);
  });

  const runner = new NodeLifecycleRunner();
  it('reaps descendants together with an expired worker', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'fx-supervised-'));
    const heartbeat = path.join(root, 'heartbeat');
    const helper = `const fs=require('node:fs');setInterval(()=>fs.writeFileSync(${JSON.stringify(heartbeat)},String(Date.now())),20);`;
    const worker = `require('node:child_process').spawn(process.execPath,['-e',${JSON.stringify(helper)}],{stdio:'ignore'});setInterval(()=>{},1000);`;
    try {
      expect(
        await runner.run({
          vector: [process.execPath, '-e', worker],
          input: Promise.resolve('{}'),
          timeoutMs: 1000,
        }),
      ).toBe('');
      const before = await fs.readFile(heartbeat, 'utf8');
      await delay(100);
      expect(await fs.readFile(heartbeat, 'utf8')).toBe(before);
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });
  it('preserves UTF-8 split across worker output chunks', async () => {
    expect(
      await runner.run({
        vector: [
          process.execPath,
          '-e',
          'process.stdout.write(Buffer.from([0xe4]));setTimeout(()=>process.stdout.write(Buffer.from([0xb8,0xad])),20)',
        ],
        input: Promise.resolve('{}'),
        timeoutMs: 2000,
      }),
    ).toBe('中');
  });
  it('discards partial output and kills a worker whose event loop never yields', async () => {
    const result = await runner.run({
      vector: [process.execPath, '-e', "process.stdout.write('partial'); while(true) {}"],
      input: Promise.resolve('{}'),
      timeoutMs: 120,
    });
    expect(result).toEqual('');
  });
  it('bounds an input stream that never ends and accepts only complete successful output', async () => {
    expect(
      await runner.run({
        vector: [process.execPath, '-e', 'process.stdin.resume()'],
        input: new Promise(() => {}),
        timeoutMs: 100,
      }),
    ).toBe('');
    expect(
      await runner.run({
        vector: [process.execPath, '-e', "process.stdout.write('done')"],
        input: Promise.resolve('{}'),
        timeoutMs: 2000,
      }),
    ).toBe('done');
  });
});
