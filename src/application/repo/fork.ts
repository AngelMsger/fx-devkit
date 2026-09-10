// A personal fork through the code host, and `origin` on the checkout if it
// has none. Adding a remote is the one place outside sync that changes a
// checkout's configuration, and it only ever adds.

import { DevkitError } from '../../domain/errors.js';
import { repoRef } from '../../domain/workspace/ref.js';
import { assertWritable, type WritePosture } from '../safety/posture.js';
import type { WorkspaceDeps } from '../workspace/deps.js';
import { checkoutDir, findRepo, inspectDisk, resolveUser } from '../workspace/inspect.js';

export interface RepoForkInput {
  readonly name: string;
  readonly dryRun: boolean;
  readonly posture: WritePosture;
}

export interface RepoForkOutput {
  readonly name: string;
  readonly url: string;
  readonly created: boolean;
  readonly origin_added: boolean;
  readonly written: boolean;
}

export class RepoFork {
  constructor(private readonly deps: WorkspaceDeps) {}

  async execute(input: RepoForkInput): Promise<RepoForkOutput> {
    const repo = findRepo(this.deps, input.name);
    const ref = repoRef(repo);
    if (ref === undefined) {
      // The manifest row takes its coordinates from the registered source, not from an entry.
      const fromSource = repo.origin === 'manifest';
      throw new DevkitError(
        'config',
        'REPO_NOT_FORKABLE',
        `"${repo.name}" names no project on the code host`,
        {
          ...(fromSource
            ? {
                hint: 'The manifest source is a directory, not a repository URL; a workspace registered from the URL can fork it.',
              }
            : {}),
          nextSteps: fromSource
            ? ['fx init <root> --from <manifest repository URL> --adopt']
            : ['fx manifest explain repos[].project'],
        },
      );
    }
    const host = this.deps.codeHost();
    if (input.dryRun) {
      const user = await resolveUser(this.deps);
      return {
        name: repo.name,
        url: host.forkUrl(user, ref),
        created: false,
        origin_added: false,
        written: false,
      };
    }
    assertWritable(input.posture, `repo fork ${repo.name}`);
    const fork = await host.fork(ref);
    const disk = await inspectDisk(this.deps, repo);
    const originAdded = disk.kind === 'checkout' && disk.remotes['origin'] === undefined;
    if (originAdded)
      await this.deps.git.addRemote(checkoutDir(this.deps, repo), 'origin', fork.url);
    return {
      name: repo.name,
      url: fork.url,
      created: fork.created,
      origin_added: originAdded,
      written: true,
    };
  }
}
