// Unregisters a machine-local entry. The directory stays: fx registered a reference, so
// it removes a reference.

import { DevkitError } from '../../domain/errors.js';
import type { LocalLayer } from '../../domain/manifest/types.js';
import { assertWritable, type WritePosture } from '../safety/posture.js';
import type { WorkspaceDeps } from '../workspace/deps.js';

export interface RepoRemoveInput {
  readonly name: string;
  readonly dryRun: boolean;
  readonly posture: WritePosture;
}

export interface RepoRemoveOutput {
  readonly path: string;
  readonly name: string;
  readonly removed_from: readonly ('repos' | 'scope')[];
  readonly directory_kept: true;
  readonly written: boolean;
}

export class RepoRemove {
  constructor(private readonly deps: WorkspaceDeps) {}

  async execute(input: RepoRemoveInput): Promise<RepoRemoveOutput> {
    const { ctx, localStore } = this.deps;
    const local = await localStore.read(ctx.name);
    const removedFrom: ('repos' | 'scope')[] = [];
    if ((local.repos ?? []).some((r) => r.name === input.name)) removedFrom.push('repos');
    if ((local.scope?.repos ?? []).includes(input.name)) removedFrom.push('scope');
    if (!removedFrom.includes('repos')) {
      const shared = ctx.manifest.workspace.result.doc.repos.some((r) => r.name === input.name);
      throw new DevkitError(
        'not_found',
        'REPO_NOT_LOCAL',
        `"${input.name}" is not registered on this machine`,
        {
          hint: shared
            ? 'It is a shared repository; deselect it instead of removing it.'
            : 'fx repo list shows local entries with origin "local".',
          nextSteps: shared ? [`fx repo unpick ${input.name}`] : ['fx repo list'],
        },
      );
    }
    const plan: RepoRemoveOutput = {
      path: localStore.path(ctx.name),
      name: input.name,
      removed_from: removedFrom,
      directory_kept: true,
      written: false,
    };
    if (input.dryRun) return plan;
    assertWritable(input.posture, `repo remove ${input.name}`);
    await localStore.update(ctx.name, (local): LocalLayer => ({
      ...local,
      repos: (local.repos ?? []).filter((r) => r.name !== input.name),
      ...(local.scope?.repos === undefined
        ? {}
        : { scope: { ...local.scope, repos: local.scope.repos.filter((n) => n !== input.name) } }),
    }));
    return { ...plan, written: true };
  }
}
