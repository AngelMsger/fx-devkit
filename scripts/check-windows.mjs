// @ts-check
// Native acceptance entry, callable from a developer terminal or a Windows CI
// node. A missing prerequisite fails; no skipped runtime is counted as passing.
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import spawn from 'cross-spawn';

const root = fileURLToPath(new URL('..', import.meta.url));
/** @type {{ platform: string, node: string, started_at: string, checks: { name: string, code: number | null, error: string | null }[], ok: boolean }} */
const report = {
  platform: process.platform,
  node: process.version,
  started_at: new Date().toISOString(),
  checks: [],
  ok: false,
};
const temporary = mkdtempSync(path.join(tmpdir(), 'fx-windows-check-'));
const reportFile = process.env.FX_WINDOWS_REPORT ?? path.join(temporary, 'report.json');
try {
  if (process.platform !== 'win32') throw new Error('Run this entry on native Windows.');
  if (Number(process.versions.node.split('.')[0]) < 22)
    throw new Error('Node 22 or newer is required.');
  /** @type {[string, string[]][]} */
  const prerequisites = [
    ['git', ['--version']],
    ['npm', ['--version']],
    ['bun', ['--version']],
    ['powershell.exe', ['-NoProfile', '-Command', '$PSVersionTable.PSVersion.ToString()']],
    ['pwsh.exe', ['-NoProfile', '-Command', '$PSVersionTable.PSVersion.ToString()']],
  ];
  for (const [name, args] of prerequisites) check(name, name, args);
  for (const script of ['lint', 'typecheck', 'test', 'test:bun', 'test:e2e', 'docs:check'])
    check(script, 'npm', ['run', script]);
  check('package-boundary', process.execPath, ['scripts/check-package.mjs']);
  const packed = check(
    'pack',
    'npm',
    ['pack', '--json', '--ignore-scripts', '--pack-destination', temporary],
    true,
  );
  const tarball = path.join(temporary, JSON.parse(packed)[0].filename);
  const prefix = path.join(temporary, 'installed 中文');
  check('install-tarball', 'npm', [
    'install',
    '--prefix',
    prefix,
    '--ignore-scripts',
    '--no-audit',
    '--no-fund',
    tarball,
  ]);
  const home = path.join(temporary, 'home');
  mkdirSync(home);
  const binary = path.join(prefix, 'node_modules', '.bin', 'fx.cmd');
  const env = {
    ...process.env,
    FX_HOME: home,
    HOME: home,
    USERPROFILE: home,
    FX_UPDATE_CHECK: '0',
  };
  check('installed-cmd', binary, ['self', 'info', '--format', 'json'], false, env);
  report.ok = true;
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
} finally {
  mkdirSync(path.dirname(reportFile), { recursive: true });
  writeFileSync(reportFile, JSON.stringify(report, null, 2) + '\n');
  console.error(`Windows acceptance report: ${reportFile}`);
}

/**
 * @param {string} name
 * @param {string} binary
 * @param {string[]} args
 * @param {boolean} [capture]
 * @param {NodeJS.ProcessEnv} [env]
 */
function check(name, binary, args, capture = false, env = process.env) {
  const result = spawn.sync(binary, args, {
    cwd: root,
    env,
    stdio: capture ? 'pipe' : 'inherit',
    encoding: 'utf8',
    windowsHide: true,
  });
  report.checks.push({ name, code: result.status, error: result.error?.message ?? null });
  if (result.error || result.status !== 0)
    throw new Error(
      `${name} failed (${result.status}): ${result.error?.message ?? result.stderr ?? ''}`,
    );
  return result.stdout ?? '';
}
