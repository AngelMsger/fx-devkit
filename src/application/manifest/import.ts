// Inspect existing checkouts and write only a candidate manifest, retaining unresolved inference for review.

import path from 'node:path';

import { DevkitError } from '../../domain/errors.js';
import { foldDefaults } from '../../domain/import/fold.js';
import { parseGitmodules } from '../../domain/import/gitmodules.js';
import {
  hostOf,
  inferRepo,
  isPersonal,
  type InferredRepo,
  type ImportProvider,
  type RepoObservation,
} from '../../domain/import/infer.js';
import { renderManifest } from '../../domain/import/render.js';
import { isAtOrInside } from '../../domain/path.js';
import { shellLine, type ResolvedShell } from '../../domain/shell.js';
import type { CodeHost, Readability } from '../../ports/code-host.js';
import type { FileSystem } from '../../ports/fs.js';
import type { Git } from '../../ports/git.js';
import type { Reporter } from '../../ports/reporter.js';
import { assertWritable, type WritePosture } from '../safety/posture.js';

export interface ImportDeps {
  readonly commandShell?: ResolvedShell | undefined;
  readonly git: Git;
  readonly fs: FileSystem;
  readonly reporter: Reporter;
  // The code host that serves the repositories kept under a directory of this machine.
  readonly localCodeHost: (directory: string) => CodeHost;
  readonly identifyProvider?: (upstream: string) => Promise<ImportProvider | undefined>;
}

export interface ImportInput {
  readonly dir: string;
  readonly out?: string | undefined;
  readonly dryRun: boolean;
  readonly posture: WritePosture;
}

interface SkippedPath {
  readonly path: string;
  readonly reason: string;
}

export interface ImportReport {
  readonly repos: number;
  readonly skipped: readonly SkippedPath[];
  readonly review: readonly { name: string; note: string }[];
  readonly branch_from: { gitmodules: number; remote_head: number; checkout: number };
}

export interface ImportOutput {
  readonly path: string | null;
  readonly written: boolean;
  readonly manifest: string;
  readonly report: ImportReport;
}

const SKIP = new Set(['node_modules']);

function insideRoot(root: string, target: string, shell: ResolvedShell | undefined): DevkitError {
  return new DevkitError(
    'conflict',
    'IMPORT_INSIDE_ROOT',
    `${target} lies inside ${root}, the directory being described`,
    {
      hint: 'The imported directory is a workspace of checkouts; the manifest belongs in a checkout of the manifest repository.',
      nextSteps: [
        `${shellLine(['fx', 'manifest', 'import', root], shell)} -o <manifest repository>/manifest/workspace.yaml`,
      ],
    },
  );
}

export class Import {
  constructor(private readonly deps: ImportDeps) {}

  async execute(input: ImportInput): Promise<ImportOutput> {
    const root = path.resolve(input.dir);
    const target = input.out === undefined ? null : path.resolve(input.out);
    if (target !== null && isAtOrInside(await this.physical(target), await this.physical(root)))
      throw insideRoot(root, target, this.deps.commandShell);
    const observed = await this.observe(root);
    const inferred = await this.infer(observed.repos);
    const repos = await this.identify(inferred.repos);
    const manifest = renderManifest(foldDefaults(repos));
    const report = summarize(repos, [...observed.skipped, ...inferred.skipped]);
    if (target === null || input.dryRun) return { path: target, written: false, manifest, report };
    assertWritable(input.posture, 'import');
    await this.deps.fs.writeText(target, manifest);
    return { path: target, written: true, manifest, report };
  }

  private async identify(repos: readonly InferredRepo[]): Promise<InferredRepo[]> {
    const identified = await Promise.all(
      repos.map(async (repo) => ({
        ...repo,
        provider: await this.deps.identifyProvider?.(repo.upstream),
      })),
    );
    const shared = identified[0]?.provider;
    const uniform =
      shared !== undefined &&
      identified.every(
        (repo) => repo.provider?.provider === shared.provider && repo.provider.host === shared.host,
      );
    return identified.map(({ provider, ...repo }) => ({
      ...repo,
      ...(provider === undefined ? {} : { provider }),
      review: uniform
        ? repo.review
        : [
            ...repo.review,
            provider === undefined
              ? 'code-host provider could not be verified from the Git remote; upstream URL is preserved. Configure providers.code-host before using hosted APIs.'
              : 'repositories use different or unresolved code hosts; upstream URLs are preserved and no shared code-host provider was selected.',
          ],
    }));
  }

  // The path as the disk knows it: symbolic links resolved up to the nearest
  // existing ancestor, the rest as spelled.
  private async physical(target: string): Promise<string> {
    const rest: string[] = [];
    let dir = target;
    while (!(await this.deps.fs.exists(dir)) && path.dirname(dir) !== dir) {
      rest.unshift(path.basename(dir));
      dir = path.dirname(dir);
    }
    return path.join(await this.deps.fs.realpath(dir), ...rest);
  }

  // A directory is a repository only when git's toplevel is the directory
  // itself; a plain directory inside a repository would otherwise inherit
  // the enclosing remotes. Containers are entered one level, no deeper.
  private async observe(
    root: string,
  ): Promise<{ repos: RepoObservation[]; skipped: SkippedPath[] }> {
    const gitmodules = parseGitmodules(
      (await this.deps.fs.readText(path.join(root, '.gitmodules'))) ?? '',
    );
    const found: RepoObservation[] = [];
    const skipped: SkippedPath[] = [];
    for (const name of await this.children(root)) {
      const dir = path.join(root, name);
      if (await this.deps.git.isToplevel(dir)) {
        found.push(await this.observeRepo(root, dir, gitmodules[name]?.branch));
        continue;
      }
      const inside: string[] = [];
      for (const child of await this.children(dir)) {
        const sub = path.join(dir, child);
        if (await this.deps.git.isToplevel(sub)) {
          inside.push(child);
          found.push(await this.observeRepo(root, sub, gitmodules[`${name}/${child}`]?.branch));
        }
      }
      if (inside.length === 0) skipped.push({ path: name, reason: 'not a repository' });
    }
    return { repos: found, skipped };
  }

  private async children(dir: string): Promise<string[]> {
    const names: string[] = [];
    for (const name of (await this.deps.fs.readDir(dir)).sort()) {
      if (name.startsWith('.') || SKIP.has(name)) continue;
      if (await this.deps.fs.isDirectory(path.join(dir, name))) names.push(name);
    }
    return names;
  }

  private async observeRepo(
    root: string,
    dir: string,
    gitmodulesBranch: string | undefined,
  ): Promise<RepoObservation> {
    const remotes = await this.deps.git.remotes(dir);
    const remoteHeads: Record<string, string | undefined> = {};
    for (const remote of ['upstream', 'origin']) {
      if (remotes[remote] !== undefined)
        remoteHeads[remote] = await this.deps.git.remoteHead(dir, remote);
    }
    return {
      // A manifest path uses forward slashes on every platform.
      rel: path.relative(root, dir).split(path.sep).join('/'),
      name: path.basename(dir),
      remotes,
      branch: (await this.deps.git.status(dir)).branch,
      remoteHeads,
      gitmodulesBranch,
    };
  }

  // Two passes: the projects named by rungs 1 and 2 are the candidate
  // list rung 3 searches for the fork-only checkouts.
  private async infer(
    observed: readonly RepoObservation[],
  ): Promise<{ repos: InferredRepo[]; skipped: SkippedPath[] }> {
    const repos: InferredRepo[] = [];
    const skipped: SkippedPath[] = [];
    const later: RepoObservation[] = [];
    for (const obs of observed) {
      const origin = obs.remotes['origin'];
      if (obs.remotes['upstream'] === undefined && origin !== undefined && isPersonal(origin)) {
        later.push(obs);
        continue;
      }
      const result = inferRepo(obs, [], () => false);
      if ('repo' in result) repos.push(result.repo);
      else skipped.push({ path: obs.rel, reason: result.skipped });
    }
    const seen = projectsByFrequency(repos);
    const answers = await this.prefetch(later, seen);
    for (const obs of later) {
      const result = inferRepo(
        obs,
        seen,
        (project, name) => answers.get(`${project}/${name}`) === 'readable',
      );
      const matched = 'repo' in result ? result.repo.project : undefined;
      const unsettled = unsettledProjects(seen, answers, obs.name, matched);
      if ('repo' in result)
        repos.push(
          unsettled.length === 0
            ? result.repo
            : { ...result.repo, review: [...result.repo.review, unsettledNote(unsettled)] },
        );
      else
        skipped.push({
          path: obs.rel,
          reason:
            unsettled.length === 0
              ? result.skipped
              : `${result.skipped}; ${unsettledNote(unsettled)}`,
        });
    }
    return { repos, skipped };
  }

  // The ladder is synchronous; the code host is not. Every candidate pair is
  // asked once, up front, and every host is resolved once however many
  // checkouts point at it.
  private async prefetch(
    later: readonly RepoObservation[],
    seen: readonly string[],
  ): Promise<Map<string, RepoPresence>> {
    const answers = new Map<string, RepoPresence>();
    const hosts = new Map<string, Promise<CodeHost | undefined>>();
    for (const obs of later) {
      const host = hostOf(obs.remotes['origin'] ?? '');
      const pending = hosts.get(host) ?? this.codeHostAt(host);
      hosts.set(host, pending);
      const codeHost = await pending;
      for (const project of seen) {
        const key = `${project}/${obs.name}`;
        if (answers.has(key) || codeHost === undefined) continue;
        answers.set(key, await probe(codeHost, project, obs.name));
      }
    }
    return answers;
  }

  // An import runs before any workspace binds a provider, so only a host that is a
  // directory on this machine can be asked; every other host stays unasked. A local
  // host that will not resolve is a configuration failure the caller must see.
  private async codeHostAt(host: string): Promise<CodeHost | undefined> {
    if (!path.isAbsolute(host) || !(await this.deps.fs.exists(host))) return undefined;
    return this.deps.localCodeHost(host);
  }
}

type RepoPresence = 'readable' | 'absent' | 'unknown';

async function probe(codeHost: CodeHost, project: string, name: string): Promise<RepoPresence> {
  try {
    return outcomeOf(await codeHost.canRead({ project, name }));
  } catch {
    return 'unknown';
  }
}

// Only `readable` names an upstream and only `missing` rules a project out. A
// query that could not be completed, or that was refused, leaves the project
// unsettled, and an unsettled project never counts as an absence.
function outcomeOf(readability: Readability): RepoPresence {
  if (readability === 'readable') return 'readable';
  return readability === 'missing' ? 'absent' : 'unknown';
}

// The search stops at the first readable project, so the projects after a
// match never entered the decision.
function unsettledProjects(
  seen: readonly string[],
  answers: ReadonlyMap<string, RepoPresence>,
  name: string,
  matched: string | undefined,
): string[] {
  const consulted = matched === undefined ? seen : seen.slice(0, seen.indexOf(matched) + 1);
  return consulted.filter((project) => answers.get(`${project}/${name}`) === 'unknown');
}

function unsettledNote(projects: readonly string[]): string {
  return `the code host did not answer for ${projects.join(', ')}; those projects were neither confirmed nor ruled out for this repository name.`;
}

function projectsByFrequency(repos: readonly InferredRepo[]): string[] {
  const counts = new Map<string, number>();
  for (const r of repos) counts.set(r.project, (counts.get(r.project) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([p]) => p);
}

function summarize(repos: readonly InferredRepo[], skipped: readonly SkippedPath[]): ImportReport {
  return {
    repos: repos.length,
    skipped,
    review: repos.flatMap((r) => r.review.map((note) => ({ name: r.name, note }))),
    branch_from: {
      gitmodules: repos.filter((r) => r.branchRung === 1).length,
      remote_head: repos.filter((r) => r.branchRung === 2).length,
      checkout: repos.filter((r) => r.branchRung === 3).length,
    },
  };
}
