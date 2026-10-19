// Runs the built binary the way a user or agent would: a child process with
// a pipe on every stream, so TTY-dependent behaviour is exercised as
// non-interactive.

import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { parse } from 'yaml';

import { mergeEnvironment } from '../../src/adapters/process/executable.js';
import { bundledToolsText } from '../../src/composition/bundled.js';
import { manifestSourceDir } from '../../src/infra/workspace-home.js';
import { runtimeTools, systemPath } from '../platform.js';
import { tempDir } from '../temp.js';

export { git, repository, type Repository } from '../git.js';
export { tempDir };

const bin = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../bin/fx.js');
export const packageName: string = JSON.parse(
  readFileSync(new URL('../../package.json', import.meta.url), 'utf8'),
).name;

// One home per test file: agent detection and Skill links never reach the person's own.
export const userHome = tempDir('fx-user-home-');

const runtime = tempDir('fx-runtime-tools-');
runtimeTools(runtime);

// The PATH a child searches: the given directories, then node and git, then the system's
// own. Nothing installed on this machine is found unless a case puts it there.
export function searchPath(...dirs: readonly string[]): string {
  return [...dirs, runtime, ...systemPath()].join(path.delimiter);
}

// What a child process inherits. The caller's own fx settings are dropped before the
// defaults apply, so a run answers the same in any session. A case that asserts what a
// first run leaves under the user home passes a home of its own.
export function childEnvironment(
  overrides: NodeJS.ProcessEnv = {},
  home: string = userHome,
): NodeJS.ProcessEnv {
  const inherited = Object.fromEntries(
    Object.entries(process.env).filter(([name]) => !name.toUpperCase().startsWith('FX_')),
  );
  return mergeEnvironment(inherited, {
    PATH: searchPath(),
    FX_HOME: freshHome(),
    FX_UPDATE_CHECK: '0',
    // Tests opt into Registry discovery explicitly; the host's npm settings are not fixture data.
    FX_REGISTRY: '',
    FX_COMMAND_SHELL: 'posix',
    ...overrides,
    HOME: home,
    USERPROFILE: home,
  });
}

export interface Run {
  readonly status: number;
  readonly stdout: string;
  readonly stderr: string;
  readonly json: () => unknown;
  readonly error: () => { category: string; code: string; next_steps: string[]; hint: string };
}

export function fx(
  args: readonly string[],
  env: NodeJS.ProcessEnv = {},
  cwd?: string,
  input?: string,
  home?: string,
): Run {
  const result = spawnSync(process.execPath, [bin, ...args], {
    encoding: 'utf8',
    input,
    env: childEnvironment(env, home),
    ...(cwd === undefined ? {} : { cwd }),
  });
  return {
    status: result.status ?? -1,
    stdout: result.stdout,
    stderr: result.stderr,
    json: () => JSON.parse(result.stdout),
    error: () => JSON.parse(lastRecord(result.stderr)).error,
  };
}

export function freshHome(): string {
  return tempDir('fx-home-');
}

// Where a workspace's manifest source lands under a given FX_HOME.
export function manifestDirOf(home: string, name: string): string {
  return manifestSourceDir(home, name);
}

// A tools.yaml that switches every bundled tool off, so a case meets only the tools it
// appends as further entries of the list.
export function disabledBundledTools(): string {
  const baseline = parse(bundledToolsText()) as { tools: { name: string }[] };
  const entries = baseline.tools.map(({ name }) => `  - {name: ${name}, enabled: false}\n`);
  return `schema_version: 3\ntools:\n${entries.join('')}`;
}

// stderr may carry notices before the error; the error is always last.
function lastRecord(text: string): string {
  return text.trim().split('\n').at(-1) ?? '';
}
