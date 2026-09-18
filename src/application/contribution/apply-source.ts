// Journal transitions precede publication and PR creation. A lost push response
// is recoverable by commit identity; a lost PR response needs explicit association.

import type { ContributionOperation } from '../../domain/contribution/operation.js';
import { DevkitError } from '../../domain/errors.js';

import { assertMatchingPr, diverged } from './plan-existing.js';
import type {
  PushSourceDeps,
  PushSourceInput,
  PushSourceOutput,
  SourcePlan,
} from './push-types.js';

interface SourceApplication {
  readonly deps: PushSourceDeps;
  readonly input: PushSourceInput;
  readonly plan: SourcePlan;
}

export async function applySource({
  deps,
  input,
  plan,
}: SourceApplication): Promise<PushSourceOutput> {
  let records = plan.records.filter((record) => !plan.output.retired.includes(record.id));
  const save = async (record: ContributionOperation): Promise<void> => {
    const next = { ...record, updatedAt: deps.clock.now().toISOString() };
    const exists = records.some((item) => item.id === next.id);
    records = exists
      ? records.map((item) => (item.id === next.id ? next : item))
      : [...records, next];
    await deps.records.write(deps.source.workspace, records);
  };
  if (plan.output.action === 'unchanged') {
    if (plan.output.retired.length) await deps.records.write(deps.source.workspace, records);
    return { ...plan.output, written: plan.output.retired.length > 0 };
  }
  if (plan.output.action === 'associate') {
    const pr = plan.output.pull_request!;
    if (pr.state === 'open')
      await save({ ...plan.operation!, phase: 'open', pullRequestId: pr.id, pullRequest: pr.url });
    else
      await deps.records.write(
        deps.source.workspace,
        records.filter((item) => item.id !== plan.operation!.id),
      );
    return { ...plan.output, written: true };
  }
  let operation = plan.operation;
  if (!operation || operation.phase === 'open') {
    operation = prepareOperation(deps, plan);
    await save(operation);
  }
  operation = await publishOperation({ deps, input, plan, operation, save });
  return completePullRequest({ deps, input, plan, operation, save });
}

interface OperationPublishing extends SourceApplication {
  readonly operation: ContributionOperation;
  readonly save: (record: ContributionOperation) => Promise<void>;
}

async function publishOperation(context: OperationPublishing): Promise<ContributionOperation> {
  const { deps, plan, save } = context;
  let { operation } = context;
  if (operation.phase === 'prepared') {
    const prepared = await deps.git.prepare({
      snapshot: plan.snapshot!,
      branch: operation.branch,
      parent: operation.parent,
      expectedHead: operation.previousHead,
      message: plan.output.message!,
    });
    if (prepared.tree !== operation.tree)
      throw new DevkitError(
        'conflict',
        'SOURCE_TREE_MISMATCH',
        'The prepared tree differs from the validated plan',
        {
          nextSteps: ['Re-run the same fx source push command with --dry-run and review the plan.'],
        },
      );
    operation = { ...operation, commit: prepared.commit, phase: 'committed' };
    await save(operation);
  }
  if (operation.phase === 'committed') {
    await deps.git.publish({
      ...deps.source,
      branch: operation.branch,
      commit: operation.commit!,
      expectedHead: operation.previousHead,
    });
    const request = {
      ...deps.source,
      remote: plan.remote!,
      branch: operation.branch,
      commit: operation.commit!,
    };
    const head = await deps.transport.head(request);
    if (head !== operation.commit && head !== operation.previousHead) throw diverged();
    if (head !== operation.commit) await deps.transport.push(request);
    operation = { ...operation, phase: 'pushed' };
    await save(operation);
  }
  return operation;
}

function prepareOperation(deps: PushSourceDeps, plan: SourcePlan): ContributionOperation {
  const snapshot = plan.snapshot!;
  const previous = plan.operation;
  return {
    id: previous?.id ?? plan.allocatedId,
    remoteIdentity: plan.identity,
    branch: plan.output.branch,
    baseBranch: plan.remote!.targetBranch,
    base: snapshot.base,
    parent: previous?.commit ?? snapshot.base,
    previousHead: previous?.commit ?? null,
    sourceFingerprint: snapshot.fingerprint,
    paths: snapshot.paths,
    files: snapshot.files.map((file) => file.path),
    tree: snapshot.tree,
    commit: null,
    phase: 'prepared',
    pullRequestId: previous?.pullRequestId ?? null,
    pullRequest: previous?.pullRequest ?? null,
    updatedAt: deps.clock.now().toISOString(),
  };
}

async function completePullRequest(context: OperationPublishing): Promise<PushSourceOutput> {
  const { input, plan, operation, save } = context;
  if (operation.phase !== 'pushed')
    throw new DevkitError(
      'conflict',
      'SOURCE_PR_CONFIRM_REQUIRED',
      'Confirm the existing PR with --pr before resuming',
      {
        nextSteps: [
          `Find the pull request for branch ${operation.branch} on the code host.`,
          'Re-run the same fx source push command with --pr <pr-id>.',
        ],
      },
    );
  let pr;
  if (operation.pullRequestId) {
    pr = await plan.host!.pullRequest({ repo: plan.remote!.target, id: operation.pullRequestId });
    if (!pr || pr.state !== 'open')
      throw new DevkitError(
        'conflict',
        'SOURCE_PR_CLOSED',
        'The PR closed during contribution; review before using --new',
        {
          nextSteps: [
            `Review pull request ${operation.pullRequestId} on the code host.`,
            'Start a separate contribution with fx source push --new.',
          ],
        },
      );
    assertMatchingPr(pr, operation, plan);
  } else {
    await save({ ...operation, phase: 'creating_pr' });
    pr = await plan.host!.createPullRequest({
      source: { repo: plan.remote!.source, branch: operation.branch },
      target: { repo: plan.remote!.target, branch: operation.baseBranch },
      title: input.title,
      description: `Issue: ${input.issue}\n\nFiles:\n${operation.files.map((file) => `- ${file}`).join('\n')}\n`,
      allowWrites: input.posture.source === 'flag' && !input.posture.readOnly,
    });
  }
  await save({ ...operation, phase: 'open', pullRequestId: pr.id, pullRequest: pr.url });
  return { ...plan.output, commit: operation.commit, pull_request: pr, written: true };
}
