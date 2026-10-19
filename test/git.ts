// Real git for fixtures: one way to run it and one way to seed a bare
// repository with an author clone, shared by the unit and end-to-end suites.

import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

// Commits made by a test look the same everywhere, and a status a test runs does
// not refresh the index it compares afterwards.
function environment(): NodeJS.ProcessEnv {
  return {
    ...process.env,
    GIT_AUTHOR_NAME: 'T',
    GIT_AUTHOR_EMAIL: 't@example.com',
    GIT_COMMITTER_NAME: 'T',
    GIT_COMMITTER_EMAIL: 't@example.com',
    GIT_OPTIONAL_LOCKS: '0',
  };
}

// The trimmed output of one git command. What git says on stderr stays out of the
// test output and reaches the reader in the error of a command that fails.
export function git(args: readonly string[], cwd: string): string {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    env: environment(),
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}

// The exact bytes of `<commit>:<path>`, which `git` would decode and trim.
export function committedBytes(file: string, cwd: string): Buffer {
  return execFileSync('git', ['show', file], {
    cwd,
    env: environment(),
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

export interface Repository {
  readonly bare: string;
  readonly author: string;
  // Writes files into the author clone, commits and pushes them.
  readonly commit: (files: Record<string, string>, message: string) => void;
}

export interface DevCommit {
  readonly files: Record<string, string>;
  readonly message: string;
}

export interface RepositoryOptions {
  // The branch the seed commit is pushed to; `main` unless given.
  readonly branch?: string;
  // Also pushes a `dev` branch: level with the seed commit, or one commit ahead of it.
  readonly dev?: 'level' | DevCommit;
}

// A bare repository plus an author clone, seeded with files in a commit named `one`.
export function repository(
  base: string,
  name: string,
  files: Record<string, string>,
  options: RepositoryOptions = {},
): Repository {
  const branch = options.branch ?? 'main';
  const bare = path.join(base, `${name}.git`);
  const author = path.join(base, `author-${name}`);
  mkdirSync(base, { recursive: true });
  git(['init', '--quiet', '--bare', '-b', branch, bare], base);
  git(['clone', '-q', bare, author], base);
  git(['checkout', '-q', '-b', branch], author);
  const commit = (next: Record<string, string>, message: string): void => {
    record(author, next, message);
    git(['push', '-q', '-u', 'origin', branch], author);
  };
  commit(files, 'one');
  if (options.dev !== undefined) {
    git(['checkout', '-q', '-b', 'dev'], author);
    if (options.dev !== 'level') record(author, options.dev.files, options.dev.message);
    git(['push', '-q', 'origin', 'dev'], author);
    git(['checkout', '-q', branch], author);
  }
  return { bare, author, commit };
}

function record(checkout: string, files: Record<string, string>, message: string): void {
  for (const [file, text] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(checkout, file)), { recursive: true });
    writeFileSync(path.join(checkout, file), text);
  }
  git(['add', '.'], checkout);
  git(['commit', '-q', '-m', message], checkout);
}
