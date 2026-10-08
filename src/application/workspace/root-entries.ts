// Read the root's own entries and keep the ones nothing accounts for. A declared
// repository counts whether or not this machine selected it: an unselected
// checkout left on disk is still a checkout of this workspace.

import path from 'node:path';

import { DERIVED_GUIDES } from '../../domain/docs/derived.js';
import {
  accountedNames,
  isStray,
  type RootEntry,
  type RootEntryKind,
} from '../../domain/workspace/root-entries.js';
import type { AgentHost } from '../../ports/agent-host.js';
import type { FileSystem } from '../../ports/fs.js';
import { collectRecipes } from '../login/collect.js';
import type { LoginDeps } from '../login/deps.js';

import type { WorkspaceDeps } from './deps.js';

export interface RootInventory {
  readonly hosts: readonly Pick<AgentHost, 'projectPaths'>[];
  readonly login: LoginDeps;
}

export async function strayRootEntries(
  deps: WorkspaceDeps,
  inventory: RootInventory,
): Promise<RootEntry[]> {
  const { ctx, fs } = deps;
  const accounted = accountedNames([
    ...DERIVED_GUIDES,
    ...ctx.manifest.workspace.result.doc.repos.map((repo) => repo.path ?? repo.name),
    ...ctx.workspace.repos.map((repo) =>
      path.relative(ctx.root, path.resolve(ctx.root, repo.path)),
    ),
    ...inventory.hosts.flatMap((host) => host.projectPaths()),
    ...collectRecipes(deps, inventory.login).flatMap((source) =>
      source.preparation?.kind === 'file' ? [source.preparation.relative] : [],
    ),
  ]);
  const strays: RootEntry[] = [];
  for (const name of (await fs.readDir(ctx.root)).sort()) {
    if (isStray(name, accounted))
      strays.push({ name, kind: await kindOf(fs, path.join(ctx.root, name)) });
  }
  return strays;
}

async function kindOf(fs: FileSystem, entry: string): Promise<RootEntryKind> {
  if ((await fs.readLink(entry)) !== undefined) return 'link';
  if (!(await fs.isDirectory(entry))) return 'file';
  return (await fs.exists(path.join(entry, '.git'))) ? 'checkout' : 'directory';
}
