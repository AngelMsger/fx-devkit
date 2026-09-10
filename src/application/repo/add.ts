// Registering a checkout that only this machine has. The personal layer
// gets a reference (name, path, upstream) and nothing a shared entry would
// carry, so it can never shadow the manifest.

import path from 'node:path';

import { DevkitError } from '../../domain/errors.js';
import type { LocalLayer, Repo } from '../../domain/manifest/types.js';
import { assertWritable, type WritePosture } from '../safety/posture.js';
import type { WorkspaceDeps } from '../workspace/deps.js';

export interface RepoAddInput {
  readonly path: string;
  readonly upstream?: string | undefined;
  readonly dryRun: boolean;
  readonly posture: WritePosture;
}

export interface RepoAddOutput {
  readonly path: string;
  readonly name: string;
  readonly repo_path: string;
  readonly upstream: string | null;
  readonly written: boolean;
}

export class RepoAdd {
  constructor(private readonly deps: WorkspaceDeps) {}

  async execute(input: RepoAddInput): Promise<RepoAddOutput> {
    const { ctx, git, localStore } = this.deps;
    const absolute = path.resolve(input.path);
    const name = path.basename(absolute);
    const relative = path.relative(ctx.root, absolute);
    const taken = [...ctx.workspace.repos.map((r) => r.name), ...ctx.workspace.available];
    if (taken.includes(name)) {
      throw new DevkitError(
        'conflict',
        'REPO_EXISTS',
        `"${name}" is already a repository of this workspace`,
        {
          hint: 'A local entry cannot shadow a shared one; pick a different directory name.',
          nextSteps: [`fx repo show ${name}`],
        },
      );
    }
    const upstream = input.upstream ?? (await upstreamFromRemotes(git, absolute));
    const entry: Repo = { name, path: relative, ...(upstream === undefined ? {} : { upstream }) };
    const local = await localStore.read(ctx.name);
    const plan: RepoAddOutput = {
      path: localStore.path(ctx.name),
      name,
      repo_path: relative,
      upstream: upstream ?? null,
      written: false,
    };
    if (input.dryRun) return plan;
    assertWritable(input.posture, `repo add ${name}`);
    const layer: LocalLayer = { ...local, repos: [...(local.repos ?? []), entry] };
    await localStore.write(ctx.name, layer);
    return { ...plan, written: true };
  }
}

async function upstreamFromRemotes(
  git: WorkspaceDeps['git'],
  dir: string,
): Promise<string | undefined> {
  if ((await git.toplevel(dir)) === undefined) return undefined;
  const remotes = await git.remotes(dir);
  return remotes['upstream'] ?? remotes['origin'];
}
