// Portable executable fixtures, including real cmd shims on Windows.

import { execFileSync } from 'node:child_process';
import { chmodSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { shellLine } from '../src/domain/shell.js';

export function writeNodeShim(dir: string, name: string, program: string): string {
  mkdirSync(dir, { recursive: true });
  const body = program.replace(/^#![^\n]*\n/, '');
  const file = path.join(dir, process.platform === 'win32' ? `${name}.cjs` : name);
  writeFileSync(file, `#!${process.execPath}\n${body}\n`, { mode: 0o755 });
  chmodSync(file, 0o755);
  if (process.platform !== 'win32') return file;
  const shim = path.join(dir, `${name}.cmd`);
  writeFileSync(shim, `@echo off\r\n"${process.execPath}" "%~dp0${name}.cjs" %*\r\n`);
  return shim;
}

export function gitExecutable(): string {
  const locator = process.platform === 'win32' ? 'where.exe' : 'which';
  return execFileSync(locator, ['git'], { encoding: 'utf8' }).trim().split(/\r?\n/)[0]!;
}

export function runtimeTools(dir: string): void {
  forward(dir, 'node', process.execPath);
  forward(dir, 'git', gitExecutable());
}

// POSIX hands over with exec: a node process in front of every git call would cost a
// git-heavy case more than the work it measures.
function forward(dir: string, name: string, executable: string): void {
  if (process.platform === 'win32') {
    writeNodeShim(
      dir,
      name,
      `const r=require('node:child_process').spawnSync(${JSON.stringify(executable)},process.argv.slice(2),{stdio:'inherit'});process.exit(r.status??1);`,
    );
    return;
  }
  mkdirSync(dir, { recursive: true });
  const file = path.join(dir, name);
  writeFileSync(file, `#!/bin/sh\nexec ${shellLine([executable], 'posix')} "$@"\n`, {
    mode: 0o755,
  });
  chmodSync(file, 0o755);
}

export function systemPath(): string[] {
  if (process.platform !== 'win32') return ['/usr/bin', '/bin'];
  const root = process.env.SystemRoot ?? 'C:\\Windows';
  return [path.join(root, 'System32'), path.join(root, 'System32', 'WindowsPowerShell', 'v1.0')];
}
