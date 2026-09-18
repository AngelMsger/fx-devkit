// Source pushes plan before their write gate and prompt outside leases. The
// locked plan is re-read before journal, object, ref or network writes begin.

import { busyError, DevkitError } from '../../domain/errors.js';
import type { Lease } from '../../ports/lock.js';
import { assertWritable } from '../safety/posture.js';
import { acquireWorkspaceOperation } from '../workspace/operation.js';

import { applySource } from './apply-source.js';
import { assertContributionIdentity } from './identity.js';
import { changed, planSource } from './plan-source.js';
import type {
  PushSourceDeps,
  PushSourceInput,
  PushSourceOutput,
  SourcePlan,
} from './push-types.js';

export class PushSource {
  constructor(private readonly deps: PushSourceDeps) {}

  async execute(input: PushSourceInput): Promise<PushSourceOutput> {
    await assertContributionIdentity(this.deps);
    const allocatedId = this.deps.ids.next();
    let plan = await planSource({ deps: this.deps, input, allocatedId });
    if (input.dryRun) return plan.output;
    assertWritable(input.posture, 'source push');
    let fetched = false;
    if (plan.output.action === 'needs-fetch') {
      await withLeases(this.deps, async () =>
        this.deps.transport.fetch({
          ...this.deps.source,
          settings: plan.settings,
          branch: plan.upstream.branch,
        }),
      );
      fetched = true;
      plan = await planSource({ deps: this.deps, input, allocatedId });
    }
    assertReady(plan);
    if (!input.yes && plan.output.action !== 'unchanged' && !(await confirm(this.deps, plan)))
      return { ...plan.output, action: 'cancelled', written: fetched, fetched };
    const result = await withLeases(this.deps, async () => {
      const current = await planSource({ deps: this.deps, input, allocatedId });
      if (current.key !== plan.key) throw changed();
      return applySource({ deps: this.deps, input, plan: current });
    });
    return { ...result, fetched, written: result.written || fetched };
  }
}

async function withLeases<T>(deps: PushSourceDeps, work: () => Promise<T>): Promise<T> {
  const leases: Lease[] = [];
  try {
    leases.push(await acquireWorkspaceOperation(deps.lock, deps.source.workspace));
    await assertContributionIdentity(deps);
    for (const key of [`workspace:${deps.source.workspace}`, `source:${deps.source.dir}`]) {
      const lease = await deps.lock.acquire({ key, waitMs: 2000 });
      if (!lease) throw busyError('SOURCE_BUSY', 'The contribution source');
      leases.push(lease);
    }
    await assertContributionIdentity(deps);
    return await work();
  } finally {
    for (const lease of leases.reverse()) await lease.release();
  }
}

async function confirm(deps: PushSourceDeps, plan: SourcePlan): Promise<boolean> {
  try {
    return await deps.prompter.confirm(
      `Contribute ${plan.output.files.length} selected file(s) from ${plan.output.source.project}/${plan.output.source.name} on ${plan.output.branch} to ${plan.output.target.project}/${plan.output.target.name}?`,
      { commands: ['Re-run with --yes to confirm this contribution.'] },
    );
  } catch (error) {
    if (error instanceof DevkitError && error.code === 'INPUT_REQUIRED')
      throw new DevkitError(
        'config',
        'CONFIRM_REQUIRED',
        'Confirm the source contribution with --yes',
        { nextSteps: ['Re-run the same fx source push command with --yes.'] },
      );
    throw error;
  }
}

function assertReady(plan: SourcePlan): void {
  if (!plan.output.validated)
    throw new DevkitError(
      'config',
      'SOURCE_VALIDATION_FAILED',
      'The contribution candidate has not passed validation',
      { nextSteps: ['Re-run the same command with --dry-run and address its findings.'] },
    );
  if (plan.output.action === 'recover')
    throw new DevkitError(
      'conflict',
      'SOURCE_PR_CONFIRM_REQUIRED',
      'PR creation may already have succeeded',
      {
        nextSteps: [
          'Inspect the remote PR and resume with its ID or URL using --pr.',
          'If no PR was created, use --new for a separately identified contribution.',
        ],
        handoff: {
          summary: 'Confirm the PR before resuming.',
          userSteps: [
            {
              id: 'source-pr',
              kind: 'manual',
              title: 'Find the PR for the recorded branch and supply its ID with --pr.',
            },
          ],
        },
      },
    );
}
