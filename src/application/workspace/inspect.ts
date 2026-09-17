// Inspect repository state and resolve code-host coordinates for workspace commands.

import path from 'node:path';

import { DevkitError } from '../../domain/errors.js';
import { nearest } from '../../domain/fuzzy.js';
import { resolveSharedRepo, type ResolvedRepo } from '../../domain/manifest/local.js';
import { samePath } from '../../domain/path.js';
import type { DiskState, Readability, RepoUrls } from '../../domain/workspace/plan.js';
import { repoRef } from '../../domain/workspace/ref.js';

import type { WorkspaceDeps } from './deps.js';

export function checkoutDir(deps: WorkspaceDeps, repo: Pick<ResolvedRepo, 'path'>): string {
  return path.resolve(deps.ctx.root, repo.path);
}

export async function inspectDisk(deps: WorkspaceDeps, repo: ResolvedRepo): Promise<DiskState> {
  const dir = checkoutDir(deps, repo);
  if (!(await deps.fs.exists(dir))) return { kind: 'absent' };
  const top = await deps.git.toplevel(dir);
  // git reports resolved paths; a workspace under /tmp or /var is reached through a symlink.
  if (top === undefined || !samePath(await deps.fs.realpath(top), await deps.fs.realpath(dir)))
    return { kind: 'not_git' };
  const compareTo = repo.branch === undefined ? undefined : `upstream/${repo.branch}`;
  const [state, remotes] = await Promise.all([
    deps.git.status(dir, compareTo),
    deps.git.remotes(dir),
  ]);
  return { kind: 'checkout', state, remotes };
}

export function urlsFor(
  deps: WorkspaceDeps,
  repo: ResolvedRepo,
  user: string | undefined,
): RepoUrls {
  const ref = repoRef(repo);
  const host = ref === undefined ? undefined : tryCodeHost(deps);
  const upstream =
    repo.upstream ?? (host === undefined || ref === undefined ? undefined : host.upstreamUrl(ref));
  const origin =
    host === undefined || ref === undefined || user === undefined
      ? undefined
      : host.forkUrl(user, ref);
  return { upstream, ...(origin === undefined ? {} : { origin }) };
}

export function webUrlFor(deps: WorkspaceDeps, repo: ResolvedRepo): string | undefined {
  const ref = repoRef(repo);
  const host = ref === undefined ? undefined : tryCodeHost(deps);
  return host === undefined || ref === undefined ? repo.upstream : host.webUrl(ref);
}

export async function readabilityOf(deps: WorkspaceDeps, repo: ResolvedRepo): Promise<Readability> {
  const ref = repoRef(repo);
  if (ref === undefined) return 'unknown';
  const host = tryCodeHost(deps);
  if (host === undefined) return 'unknown';
  try {
    return await host.canRead(ref);
  } catch (err) {
    // API prerequisites are optional for Git transport; explicit access denials
    // returned by the provider remain authoritative. Programming errors still fail.
    if (
      !(err instanceof DevkitError) ||
      !['TOOL_MISSING', 'LOGIN_REQUIRED', 'VECTOR_UNTRUSTED', 'PROCESS_TIMEOUT'].includes(err.code)
    )
      throw err;
    return 'unknown';
  }
}

// config.user first: a token-authenticated host may not know who is asking.
export async function resolveUser(deps: WorkspaceDeps): Promise<string> {
  if (deps.user !== undefined) return deps.user;
  return (await deps.codeHost().whoami()).user;
}

export function contactFor(deps: WorkspaceDeps, repo: ResolvedRepo): string | undefined {
  return repo.project === undefined
    ? undefined
    : deps.ctx.manifest.workspace.result.doc.projects?.[repo.project]?.contact;
}

export function findRepo(deps: WorkspaceDeps, name: string): ResolvedRepo {
  const repo = deps.ctx.workspace.repos.find((r) => r.name === name);
  if (repo !== undefined) return repo;
  const known = [...deps.ctx.workspace.repos.map((r) => r.name), ...deps.ctx.workspace.available];
  return missingRepo(name, known);
}

// Discovery can inspect unpicked shared entries without widening the
// selection used by commands that operate on tracked checkouts.
export function findKnownRepo(deps: WorkspaceDeps, name: string): ResolvedRepo {
  const picked = deps.ctx.workspace.repos.find((repo) => repo.name === name);
  if (picked !== undefined) return picked;
  const workspace = deps.ctx.manifest.workspace.result.doc;
  const repo = workspace.repos.find((entry) => entry.name === name);
  if (repo !== undefined) return resolveSharedRepo({ workspace, local: deps.ctx.local, repo });
  const all = [
    ...deps.ctx.workspace.repos,
    ...workspace.repos
      .filter((entry) => deps.ctx.workspace.available.includes(entry.name))
      .map((entry) => resolveSharedRepo({ workspace, local: deps.ctx.local, repo: entry })),
  ];
  const matches = all.filter((entry) => entry.aka?.includes(name));
  if (matches.length === 1) return matches[0]!;
  if (matches.length > 1) {
    throw new DevkitError(
      'conflict',
      'REPO_ALIAS_AMBIGUOUS',
      `repository alias "${name}" matches ${matches.map((entry) => entry.name).join(', ')}`,
      {
        hint: 'Use a canonical repository name to choose one.',
        nextSteps: matches.map((entry) => `fx repo show ${entry.name}`),
      },
    );
  }
  return missingRepo(
    name,
    all.flatMap((entry) => [entry.name, ...(entry.aka ?? [])]),
  );
}

function missingRepo(name: string, known: readonly string[]): never {
  const suggestion = nearest(name, known);
  throw new DevkitError(
    'not_found',
    'REPO_NOT_FOUND',
    `no repository named "${name}" in this workspace`,
    {
      hint:
        suggestion === undefined
          ? 'fx repo list shows the known names.'
          : `Did you mean "${suggestion}"?`,
      nextSteps: ['fx repo list'],
    },
  );
}

function tryCodeHost(deps: WorkspaceDeps): ReturnType<WorkspaceDeps['codeHost']> | undefined {
  try {
    return deps.codeHost();
  } catch (error) {
    if (
      !(error instanceof DevkitError) ||
      !['PROVIDER_UNBOUND', 'PROVIDER_UNKNOWN', 'PROVIDER_VAR_MISSING'].includes(error.code)
    )
      throw error;
    return undefined;
  }
}
