import { mkdtempSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  executableCandidates,
  mergeEnvironment,
} from '../../../src/adapters/process/executable.js';
import { NodeProcess } from '../../../src/adapters/process/node-process.js';
import { writeNodeShim } from '../../platform.js';

describe('Windows executable resolution', () => {
  it('uses PATHEXT in order and never implicitly searches the working directory', () => {
    expect(
      executableCandidates(
        'git',
        {
          cwd: 'C:\\work',
          env: { Path: '"C:\\Program Files\\Git";D:\\bin', PATHEXT: '.EXE;.CMD' },
        },
        'win32',
      ),
    ).toEqual([
      'C:\\Program Files\\Git\\git.EXE',
      'C:\\Program Files\\Git\\git.CMD',
      'C:\\Program Files\\Git\\git',
      'D:\\bin\\git.EXE',
      'D:\\bin\\git.CMD',
      'D:\\bin\\git',
    ]);
    expect(executableCandidates('git', { cwd: 'C:\\work', env: { PATH: '' } }, 'win32')).toEqual(
      [],
    );
  });

  it('honours explicit executable paths and invocation environment overrides', () => {
    expect(executableCandidates('.\\bin\\git.exe', { cwd: 'C:\\work', env: {} }, 'win32')).toEqual([
      'C:\\work\\bin\\git.exe',
    ]);
    expect(
      mergeEnvironment(
        { Path: 'old', PATHEXT: '.EXE', Token: 'old' },
        { PATH: 'new', pathext: '.CMD', TOKEN: 'new' },
        'win32',
      ),
    ).toEqual({ PATH: 'new', pathext: '.CMD', TOKEN: 'new' });
    expect(mergeEnvironment({ Path: 'old' }, { PATH: 'new' }, 'linux')).toEqual({
      Path: 'old',
      PATH: 'new',
    });
  });

  it('checks a dotted command name before trying PATHEXT suffixes', () => {
    expect(
      executableCandidates(
        'my.tool',
        { cwd: 'C:\\work', env: { PATH: 'C:\\bin', PATHEXT: '.EXE' } },
        'win32',
      ),
    ).toEqual(['C:\\bin\\my.tool', 'C:\\bin\\my.tool.EXE']);
  });
});

describe('portable command execution', () => {
  it('preserves arguments and input through a PATH shim without evaluating them', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'fx-中文 shim-'));
    const marker = path.join(dir, 'must-not-exist');
    writeNodeShim(
      dir,
      'fixture',
      "process.stdin.resume();let s='';process.stdin.on('data',d=>s+=d);process.stdin.on('end',()=>console.log(JSON.stringify({args:process.argv.slice(2),stdin:s,env:process.env.FX_ARG_TEST}))); ",
    );
    const args = [
      '',
      'a b',
      '中文',
      'a"b',
      "a'b",
      'C:\\space dir\\',
      '&|<>^%!()',
      '%PATH%',
      '!PATH!',
      `& echo bad > "${marker}"`,
      '$(echo bad)',
    ];
    const process = new NodeProcess();
    const env = { PATH: dir, FX_ARG_TEST: 'value' };
    expect(await process.which('fixture', { env })).toBeDefined();
    const result = await process.run(['fixture', ...args], {
      env,
      input: '中文\r\n',
      timeoutMs: 5000,
    });
    expect(result.code, result.stderr).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual({ args, stdin: '中文\r\n', env: 'value' });
    expect(existsSync(marker)).toBe(false);
  });

  it('cleans up helpers when a command is aborted', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'fx-tree-'));
    const file = path.join(dir, 'helper');
    const script = `const c=require('node:child_process').spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore'});require('node:fs').writeFileSync(${JSON.stringify(file)},String(c.pid));setInterval(()=>{},1000);`;
    const control = new AbortController();
    const run = new NodeProcess().run([process.execPath, '-e', script], {
      signal: control.signal,
      timeoutMs: 5000,
    });
    const failure = expect(run).rejects.toMatchObject({ code: 'PROCESS_ABORTED' });
    for (let n = 0; n < 100 && !existsSync(file); n++) await new Promise((r) => setTimeout(r, 20));
    control.abort();
    await failure;
    const pid = Number(readFileSync(file, 'utf8'));
    await new Promise((r) => setTimeout(r, 200));
    expect(() => process.kill(pid, 0)).toThrow();
  });
});
