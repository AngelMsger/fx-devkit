// Portable executable fixtures, including real cmd shims on Windows.

import { execFileSync } from 'node:child_process';
import { chmodSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

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
  for (const [name, executable] of [
    ['node', process.execPath],
    ['git', gitExecutable()],
  ] as const) {
    writeNodeShim(
      dir,
      name,
      `const r=require('node:child_process').spawnSync(${JSON.stringify(executable)},process.argv.slice(2),{stdio:'inherit'});process.exit(r.status??1);`,
    );
  }
}

export function systemPath(): string[] {
  if (process.platform !== 'win32') return ['/usr/bin', '/bin'];
  const root = process.env.SystemRoot ?? 'C:\\Windows';
  return [path.join(root, 'System32'), path.join(root, 'System32', 'WindowsPowerShell', 'v1.0')];
}
