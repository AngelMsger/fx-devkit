// The process adapter under the conditions only real processes show: fx
// interrupted while a bounded child (and the helper it spawned) is running,
// with and without another listener owning the signal.

import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

const adapter = path.resolve('dist/adapters/process/node-process.js');

type Listener = 'none' | 'persistent' | 'exit' | 'once' | 'restart';

const script = (dir: string, listener: Listener): string =>
  [
    `import { NodeProcess } from ${JSON.stringify(adapter)};`,
    'const proc = new NodeProcess();',
    'let hits = 0;',
    {
      none: '',
      persistent:
        "process.on('SIGINT', () => { hits += 1; process.stdout.write('hit ' + hits + '\\n'); });",
      exit: "process.on('SIGINT', () => process.exit(0));",
      once: "process.once('SIGINT', () => { hits += 1; process.stdout.write('hit ' + hits + '\\n'); });",
      restart:
        "process.on('SIGINT', () => { hits += 1; process.stdout.write('hit ' + hits + '\\n'); if (hits === 1) { start(2); setTimeout(() => process.stdout.write('ready 2\\n'), 300); } });",
    }[listener],
    // A bounded shell that records its own pid and its helper's, then waits.
    `const shell = (n) => 'echo $$ > ${dir}/shell' + n + '; sleep 30 & echo $! > ${dir}/helper' + n + '; wait';`,
    "const start = (n) => proc.run(['sh', '-c', shell(n)], { timeoutMs: 20000 }).then(() => process.stdout.write('run ' + n + ' resolved\\n'), (e) => process.stdout.write('run ' + n + ' ' + e.code + '\\n'));",
    'start(1);',
    "setTimeout(() => process.stdout.write('ready 1\\n'), 300);",
    "process.stdin.on('data', () => { start(2); setTimeout(() => process.stdout.write('ready 2\\n'), 300); });",
  ].join('\n');

const alive = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

const pid = (file: string): number => {
  const value = Number(readFileSync(file, 'utf8').trim());
  expect(value).toBeGreaterThan(1);
  return value;
};

const wait = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

function parent(
  dir: string,
  listener: Listener,
): { child: ChildProcess; saw: (text: string) => Promise<void> } {
  const child = spawn(process.execPath, ['--input-type=module', '-e', script(dir, listener)], {
    stdio: ['pipe', 'pipe', 'inherit'],
  });
  let output = '';
  const waiters: { text: string; resolve: () => void }[] = [];
  child.stdout.on('data', (chunk: Buffer) => {
    output += chunk.toString();
    for (const w of waiters.splice(0))
      if (output.includes(w.text)) w.resolve();
      else waiters.push(w);
  });
  const saw = (text: string): Promise<void> =>
    output.includes(text)
      ? Promise.resolve()
      : new Promise((resolve) => waiters.push({ text, resolve }));
  return { child, saw };
}

// POSIX signal disposition/re-sending has no equivalent in Windows child.kill.
// Windows timeout/AbortSignal tree cleanup is exercised in windows-process.test.ts.
describe.skipIf(process.platform === 'win32')(
  'a bounded child when fx itself is interrupted',
  () => {
    it('dies with its process group, and fx exits on the signal as usual', async () => {
      const dir = mkdtempSync(path.join(tmpdir(), 'fx-proc-'));
      const p = parent(dir, 'none');
      await p.saw('ready 1');
      const shell = pid(path.join(dir, 'shell1'));
      const helper = pid(path.join(dir, 'helper1'));
      expect(alive(shell) && alive(helper)).toBe(true);
      p.child.kill('SIGINT');
      const signal = await new Promise((resolve) => p.child.on('close', (_, s) => resolve(s)));
      expect(signal).toBe('SIGINT');
      await wait(200);
      expect([alive(shell), alive(helper)]).toEqual([false, false]);
    }, 15000);

    it('dies on each interrupt when another listener owns the signal, which is called once per signal', async () => {
      const dir = mkdtempSync(path.join(tmpdir(), 'fx-proc-'));
      const p = parent(dir, 'persistent');
      await p.saw('ready 1');
      const first = [pid(path.join(dir, 'shell1')), pid(path.join(dir, 'helper1'))];
      p.child.kill('SIGINT');
      await p.saw('hit 1');
      await wait(200);
      expect(first.map(alive)).toEqual([false, false]);
      expect(p.child.exitCode).toBeNull();
      p.child.stdin?.write('go\n');
      await p.saw('ready 2');
      const second = [pid(path.join(dir, 'shell2')), pid(path.join(dir, 'helper2'))];
      p.child.kill('SIGINT');
      await p.saw('hit 2');
      await wait(200);
      expect(second.map(alive)).toEqual([false, false]);
      await p.saw('run 2 PROCESS_ABORTED');
      p.child.kill('SIGKILL');
    }, 15000);

    it('is dealt with before an earlier listener exits fx, and a once-listener keeps ownership', async () => {
      const exiting = mkdtempSync(path.join(tmpdir(), 'fx-proc-'));
      const e = parent(exiting, 'exit');
      await e.saw('ready 1');
      const pair = [pid(path.join(exiting, 'shell1')), pid(path.join(exiting, 'helper1'))];
      e.child.kill('SIGINT');
      const code = await new Promise((resolve) => e.child.on('close', (c) => resolve(c)));
      expect(code).toBe(0);
      await wait(200);
      expect(pair.map(alive)).toEqual([false, false]);

      const owned = mkdtempSync(path.join(tmpdir(), 'fx-proc-'));
      const o = parent(owned, 'once');
      await o.saw('ready 1');
      const owner = [pid(path.join(owned, 'shell1')), pid(path.join(owned, 'helper1'))];
      o.child.kill('SIGINT');
      await o.saw('hit 1');
      await wait(200);
      expect(owner.map(alive)).toEqual([false, false]);
      expect(o.child.exitCode).toBeNull();
      o.child.kill('SIGKILL');
    }, 15000);

    it('protects a child that another listener starts while the interrupt is being handled', async () => {
      const dir = mkdtempSync(path.join(tmpdir(), 'fx-proc-'));
      const p = parent(dir, 'restart');
      await p.saw('ready 1');
      const first = [pid(path.join(dir, 'shell1')), pid(path.join(dir, 'helper1'))];
      p.child.kill('SIGINT');
      await p.saw('ready 2');
      const second = [pid(path.join(dir, 'shell2')), pid(path.join(dir, 'helper2'))];
      expect(first.map(alive)).toEqual([false, false]);
      expect(second.map(alive)).toEqual([true, true]);
      p.child.kill('SIGINT');
      await p.saw('run 2 PROCESS_ABORTED');
      await wait(200);
      expect(second.map(alive)).toEqual([false, false]);
      expect(p.child.exitCode).toBeNull();
      p.child.kill('SIGKILL');
    }, 15000);
  },
);
