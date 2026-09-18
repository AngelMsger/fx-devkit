// Resolve proposed personal layers and reject physical checkout overlap before they are persisted.
import path from 'node:path';

import { DevkitError } from '../../domain/errors.js';
import {
  applyLocal,
  type ResolvedRepo,
  type ResolvedWorkspace,
} from '../../domain/manifest/local.js';
import type { LocalLayer, Workspace } from '../../domain/manifest/types.js';
import { isAtOrInside, windowsPathProblem } from '../../domain/path.js';
import type { FileReader } from '../../ports/fs.js';

export async function physicalPath(fs: FileReader, target: string): Promise<string> {
  const absolute = path.resolve(target);
  let ancestor = absolute;
  while (!(await fs.exists(ancestor))) {
    const parent = path.dirname(ancestor);
    if (parent === ancestor) break;
    ancestor = parent;
  }
  return path.resolve(await fs.realpath(ancestor), path.relative(ancestor, absolute));
}

export async function validateWorkspaceLayer(
  fs: FileReader,
  root: string,
  shared: Workspace,
  local: LocalLayer,
  manifestRepo?: ResolvedRepo,
): Promise<ResolvedWorkspace> {
  const workspace = applyLocal(shared, local);
  const repos =
    manifestRepo === undefined || workspace.repos.some((repo) => repo.name === manifestRepo.name)
      ? workspace.repos
      : [...workspace.repos, manifestRepo];
  const physicalRoot = await physicalPath(fs, root);
  const owners: { path: string; name: string }[] = [];
  for (const repo of repos) {
    const resolved = await physicalPath(fs, path.resolve(root, repo.path));
    const problem = path.sep === '\\' ? windowsPathProblem(resolved) : undefined;
    if (problem)
      throw new DevkitError('config', 'LOCAL_INVALID', problem, {
        nextSteps: [`Give ${repo.name} a checkout path Windows can address, then select it again.`],
      });
    if (repo.origin !== 'manifest' && isAtOrInside(physicalRoot, resolved))
      throw invalid(`${repo.name} would make the workspace root part of its checkout: ${resolved}`);
    const owner = owners.find(
      (item) => isAtOrInside(resolved, item.path) || isAtOrInside(item.path, resolved),
    );
    if (owner !== undefined)
      throw invalid(`${repo.name} and ${owner.name} resolve to overlapping checkouts: ${resolved}`);
    owners.push({ path: resolved, name: repo.name });
  }
  return { ...workspace, repos };
}

function invalid(message: string): DevkitError {
  return new DevkitError('config', 'LOCAL_INVALID', message, {
    hint: 'Repository checkouts must be disjoint and must not contain the workspace root.',
    nextSteps: [
      'Keep the previous selection, or remove the conflicting local repository reference before selecting these repositories.',
    ],
  });
}
