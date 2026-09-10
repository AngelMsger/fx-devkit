// What a checkout says about where it came from and which branch it means
// to follow, read off ladders because no single signal is right everywhere
// (docs/design/import.md). Every rung below the first leaves a review note
// on the entry, so the manifest carries its own uncertainty.

import { refFromUrl } from '../workspace/ref.js';

export interface RepoObservation {
  // Path relative to the workspace root; the entry's `path` when it differs from the name.
  readonly rel: string;
  readonly name: string;
  readonly remotes: Readonly<Record<string, string>>;
  readonly branch: string | undefined;
  readonly remoteHeads: Readonly<Record<string, string | undefined>>;
  readonly gitmodulesBranch: string | undefined;
}

export type UpstreamRung = 1 | 2 | 3;
export type BranchRung = 1 | 2 | 3;

export interface InferredRepo {
  readonly name: string;
  readonly rel: string;
  readonly upstream: string;
  readonly upstreamRung: UpstreamRung;
  readonly host: string;
  readonly project: string;
  readonly branch: string;
  readonly branchRung: BranchRung;
  readonly originPersonal: boolean;
  readonly review: readonly string[];
}

export type Probe = (project: string, name: string) => boolean;

// Bitbucket Data Center keeps personal repositories under `~user`.
export function isPersonal(url: string): boolean {
  return refFromUrl(url)?.project.startsWith('~') ?? false;
}

export function hostOf(url: string): string {
  const ref = refFromUrl(url);
  if (ref === undefined) return url;
  return url.slice(0, url.length - `/${ref.project}/${ref.name}.git`.length);
}

export function inferUpstream(
  obs: RepoObservation,
  seenProjects: readonly string[],
  probe: Probe,
): { url: string; rung: UpstreamRung } | undefined {
  const upstream = obs.remotes['upstream'];
  if (upstream !== undefined) return { url: upstream, rung: 1 };
  const origin = obs.remotes['origin'];
  if (origin === undefined) return undefined;
  if (!isPersonal(origin)) return { url: origin, rung: 2 };
  const host = hostOf(origin);
  for (const project of seenProjects) {
    if (probe(project, obs.name)) return { url: `${host}/${project}/${obs.name}.git`, rung: 3 };
  }
  return undefined;
}

export function inferBranch(
  obs: RepoObservation,
  upstreamRemote: string,
): { name: string; rung: BranchRung } | undefined {
  if (obs.gitmodulesBranch !== undefined) return { name: obs.gitmodulesBranch, rung: 1 };
  const head = obs.remoteHeads[upstreamRemote];
  if (head !== undefined) return { name: head, rung: 2 };
  if (obs.branch !== undefined) return { name: obs.branch, rung: 3 };
  return undefined;
}

export type Inference = { readonly repo: InferredRepo } | { readonly skipped: string };

export function inferRepo(
  obs: RepoObservation,
  seenProjects: readonly string[],
  probe: Probe,
): Inference {
  const upstream = inferUpstream(obs, seenProjects, probe);
  if (upstream === undefined) {
    return {
      skipped:
        obs.remotes['origin'] === undefined
          ? 'no remote; a manifest describes remotes'
          : 'origin is a personal fork and no project of this workspace has a repository of this name',
    };
  }
  const ref = refFromUrl(upstream.url);
  if (ref === undefined)
    return { skipped: `upstream ${upstream.url} does not name a project and repository` };
  const branch = inferBranch(obs, obs.remotes['upstream'] === undefined ? 'origin' : 'upstream');
  if (branch === undefined)
    return { skipped: 'no branch could be determined (detached HEAD, no remote HEAD)' };
  const review: string[] = [];
  if (upstream.rung === 3)
    review.push(
      'upstream inferred by searching for a repository of this name; nothing in the checkout named the project.',
    );
  if (branch.rung === 3)
    review.push('branch taken from the current checkout, which may be a task branch.');
  return {
    repo: {
      name: obs.name,
      rel: obs.rel,
      upstream: upstream.url,
      upstreamRung: upstream.rung,
      host: hostOf(upstream.url),
      project: ref.project,
      branch: branch.name,
      branchRung: branch.rung,
      originPersonal: obs.remotes['origin'] !== undefined && isPersonal(obs.remotes['origin']),
      review,
    },
  };
}
