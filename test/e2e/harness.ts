// Runs the built binary the way a user or agent would: a child process with
// a pipe on every stream, so TTY-dependent behaviour is exercised as
// non-interactive.

import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { mergeEnvironment } from '../../src/adapters/process/executable.js';
import { manifestSourceDir } from '../../src/infra/workspace-home.js';

const bin = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../bin/fx.js');
// One home per test run: agent detection and Skill links never reach the person's own.
export const packageName: string = JSON.parse(
  readFileSync(new URL('../../package.json', import.meta.url), 'utf8'),
).name;
export const userHome = mkdtempSync(path.join(tmpdir(), 'fx-user-home-'));

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
): Run {
  const result = spawnSync(process.execPath, [bin, ...args], {
    encoding: 'utf8',
    input,
    env: mergeEnvironment(process.env, {
      FX_HOME: freshHome(),
      FX_UPDATE_CHECK: '0',
      FX_COMMAND_SHELL: 'posix',
      ...env,
      HOME: userHome,
      USERPROFILE: userHome,
    }),
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
  return mkdtempSync(path.join(tmpdir(), 'fx-home-'));
}

// Where a workspace's manifest source lands under a given FX_HOME.
export function manifestDirOf(home: string, name: string): string {
  return manifestSourceDir(home, name);
}

// git with a fixed identity, so commits made by a test look the same everywhere.
export function git(args: readonly string[], cwd: string): string {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: 'T',
      GIT_AUTHOR_EMAIL: 't@example.com',
      GIT_COMMITTER_NAME: 'T',
      GIT_COMMITTER_EMAIL: 't@example.com',
    },
  }).trim();
}

export interface Repository {
  readonly bare: string;
  readonly author: string;
  // Writes files into the author clone, commits and pushes them.
  readonly commit: (files: Record<string, string>, message: string) => void;
}

// A bare repository on `main` plus an author clone, seeded with files.
export function repository(base: string, name: string, files: Record<string, string>): Repository {
  const bare = path.join(base, `${name}.git`);
  const author = path.join(base, `author-${name}`);
  git(['init', '--quiet', '--bare', '-b', 'main', bare], base);
  git(['clone', '-q', bare, author], base);
  git(['checkout', '-q', '-b', 'main'], author);
  const commit = (next: Record<string, string>, message: string): void => {
    for (const [file, text] of Object.entries(next)) {
      mkdirSync(path.dirname(path.join(author, file)), { recursive: true });
      writeFileSync(path.join(author, file), text);
    }
    git(['add', '.'], author);
    git(['commit', '-q', '-m', message], author);
    git(['push', '-q', '-u', 'origin', 'main'], author);
  };
  commit(files, 'one');
  return { bare, author, commit };
}

// stderr may carry notices before the error; the error is always last.
function lastRecord(text: string): string {
  return text.trim().split('\n').at(-1) ?? '';
}
