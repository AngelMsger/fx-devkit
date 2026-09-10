// How a repository entry names its place on the code host, and the two URL templates
// every host in this family shares (host / project / name, forks under ~user). A
// provider may override the templates; these are the defaults it starts from.

import type { ResolvedRepo } from '../manifest/local.js';

export interface RepoRef {
  readonly project: string;
  readonly name: string;
}

export function repoRef(
  repo: Pick<ResolvedRepo, 'name' | 'project' | 'upstream'>,
): RepoRef | undefined {
  if (repo.upstream !== undefined) return refFromUrl(repo.upstream) ?? projectRef(repo);
  return projectRef(repo);
}

function projectRef(repo: Pick<ResolvedRepo, 'name' | 'project'>): RepoRef | undefined {
  return repo.project === undefined ? undefined : { project: repo.project, name: repo.name };
}

// ssh://git@host:12345/PROJECT/name.git and git@host:PROJECT/name.git → { project: PROJECT, name }
export function refFromUrl(url: string): RepoRef | undefined {
  const segments = url
    .replace(/^([^/@]+@[^/:]+):(?!\/\/)/, '$1/')
    .replace(/\/+$/, '')
    .split('/');
  const last = segments[segments.length - 1];
  const project = segments[segments.length - 2];
  if (last === undefined || project === undefined || project.includes(':')) return undefined;
  return { project, name: last.replace(/\.git$/, '') };
}

export function repoUrl(host: string, owner: string, name: string): string {
  return `${host.replace(/\/+$/, '')}/${owner}/${name}.git`;
}
