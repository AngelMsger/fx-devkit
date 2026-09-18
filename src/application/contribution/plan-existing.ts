// Existing operations are reused from authoritative PR/branch evidence. An
// uncertain create is an association handoff, never another automatic create.

import { buildContributionCandidate } from '../../domain/contribution/candidate.js';
import { displayContributionPaths } from '../../domain/contribution/display-paths.js';
import type { ContributionOperation } from '../../domain/contribution/operation.js';
import { decideContributionReuse } from '../../domain/contribution/pending.js';
import type { ContributionPullRequest } from '../../domain/contribution/pull-request.js';
import { DevkitError } from '../../domain/errors.js';

import type { PushSourceDeps, PushSourceInput, SourcePlan } from './push-types.js';

interface ExistingPlanning {
  readonly deps: PushSourceDeps;
  readonly input: PushSourceInput;
  readonly plan: SourcePlan;
}
interface OperationPlanning extends ExistingPlanning {
  readonly operation: ContributionOperation;
}

export async function planExistingOperation(context: ExistingPlanning): Promise<SourcePlan> {
  const { input, plan } = context;
  if (input.forceNew) return plan;
  const retired: string[] = [];
  for (const operation of [...plan.records]
    .reverse()
    .filter((record) => record.remoteIdentity === plan.identity)) {
    const candidate = await planOperation({ ...context, operation });
    if (!candidate) {
      retired.push(operation.id);
      continue;
    }
    return { ...candidate, output: { ...candidate.output, retired } };
  }
  if (input.prRef) throw associationInvalid();
  return { ...plan, output: { ...plan.output, retired } };
}

async function planOperation(context: OperationPlanning): Promise<SourcePlan | null> {
  const { deps, input, plan, operation } = context;
  const pr = operation.pullRequestId
    ? await plan.host!.pullRequest({ repo: plan.remote!.target, id: operation.pullRequestId })
    : null;
  if (operation.pullRequestId && (!pr || pr.state !== 'open')) return null;
  if (pr) assertMatchingPr(pr, operation, plan);
  const head = await deps.transport.head({
    ...deps.source,
    remote: plan.remote!,
    branch: operation.branch,
  });
  const current = {
    ...plan,
    operation,
    output: {
      ...plan.output,
      branch: operation.branch,
      commit: operation.commit,
      tree: operation.tree,
      files: operation.files,
      pull_request: pr,
    },
  };
  if (input.prRef && operation.phase !== 'open')
    return associate({ ...context, plan: current }, head);
  if (head === null && ['open', 'pushed', 'creating_pr'].includes(operation.phase)) return null;
  if (operation.phase !== 'open') return resume({ ...context, plan: current }, head);
  if (input.prRef) throw associationInvalid();
  return updatePlan({ ...context, plan: current }, head);
}

async function updatePlan(context: OperationPlanning, head: string | null): Promise<SourcePlan> {
  const { deps, input, plan, operation } = context;
  const snapshot = await deps.git.capture({
    ...deps.source,
    base: plan.upstream.sha,
    paths: input.paths,
  });
  const decision = decideContributionReuse({
    pending: operation,
    remoteIdentity: plan.identity,
    files: displayContributionPaths(snapshot.files.map((file) => file.path)),
    tree: snapshot.tree,
    remoteHead: head,
    pullRequestState: 'open',
    forceNew: false,
  });
  if (decision === 'conflict') throw divergedError();
  if (decision === 'new')
    return {
      ...plan,
      operation: null,
      output: {
        ...plan.output,
        action: 'needs-fetch',
        branch: `fx/contribution/${plan.allocatedId}`,
        commit: null,
        pull_request: null,
      },
    };
  const validation = await deps.validator.execute({
    files: buildContributionCandidate({ base: snapshot.baseFiles, changes: snapshot.files }),
    changes: snapshot.files,
    cliVersion: input.cliVersion,
  });
  return {
    ...plan,
    snapshot,
    output: {
      ...plan.output,
      action: decision === 'unchanged' ? 'unchanged' : 'update',
      message: decision === 'unchanged' ? null : plan.output.message,
      title: null,
      tree: snapshot.tree,
      files: displayContributionPaths(snapshot.files.map((file) => file.path)),
      findings: validation.findings,
      validated: validation.ok,
    },
  };
}

async function resume(context: OperationPlanning, head: string | null): Promise<SourcePlan> {
  const { deps, input, plan, operation } = context;
  assertResumeSelection(input, operation);
  if (head !== operation.commit && head !== operation.previousHead) throw divergedError();
  const action = operation.phase === 'creating_pr' ? 'recover' : 'resume';
  if (operation.phase !== 'prepared') {
    const commit =
      operation.commit && (await deps.git.inspect({ ...deps.source, ref: operation.commit }));
    if (
      !commit ||
      commit.tree !== operation.tree ||
      commit.parents.length !== 1 ||
      commit.parents[0] !== operation.parent
    )
      throw operationInvalidError(deps.source.dir, operation);
    return {
      ...plan,
      output: {
        ...plan.output,
        action,
        message: null,
        title: operation.pullRequestId ? null : plan.output.title,
        validated: true,
      },
    };
  }
  const snapshot = await deps.git.capture({
    ...deps.source,
    base: operation.base,
    paths: operation.paths,
  });
  if (snapshot.fingerprint !== operation.sourceFingerprint)
    throw snapshotChangedError(deps.source.dir, operation);
  const validation = await deps.validator.execute({
    files: buildContributionCandidate({ base: snapshot.baseFiles, changes: snapshot.files }),
    changes: snapshot.files,
    cliVersion: input.cliVersion,
  });
  return {
    ...plan,
    snapshot,
    output: { ...plan.output, action, validated: validation.ok, findings: validation.findings },
  };
}

async function associate(
  { input, plan, operation }: OperationPlanning,
  head: string | null,
): Promise<SourcePlan> {
  assertResumeSelection(input, operation);
  if (operation.phase !== 'creating_pr' && operation.phase !== 'pushed') throw associationInvalid();
  const pr = await plan.host!.pullRequest({ repo: plan.remote!.target, id: input.prRef! });
  if (!pr || (pr.state === 'open' && head !== operation.commit)) throw associationInvalid();
  assertMatchingPr(pr, operation, plan);
  return {
    ...plan,
    output: {
      ...plan.output,
      action: 'associate',
      message: null,
      title: null,
      validated: true,
      pull_request: pr,
    },
  };
}

function assertResumeSelection(input: PushSourceInput, operation: ContributionOperation): void {
  if (
    input.paths.length !== operation.paths.length ||
    input.paths.some((path) => !operation.paths.includes(path))
  )
    throw new DevkitError(
      'conflict',
      'SOURCE_RECOVERY_REQUIRED',
      'Resume with the original path selection or use --new',
      {
        nextSteps: [
          `Re-run with the recorded paths: ${operation.paths.join(' ')}`,
          'Or start a separate contribution with --new.',
        ],
      },
    );
}

export function assertMatchingPr(
  pr: ContributionPullRequest,
  operation: ContributionOperation,
  plan: SourcePlan,
): void {
  const remote = plan.remote!;
  if (
    pr.source.branch !== operation.branch ||
    pr.target.branch !== operation.baseBranch ||
    pr.source.repo.project !== remote.source.project ||
    pr.source.repo.name !== remote.source.name ||
    pr.target.repo.project !== remote.target.project ||
    pr.target.repo.name !== remote.target.name
  )
    throw associationInvalid();
}

function operationInvalidError(dir: string, operation: ContributionOperation): DevkitError {
  return new DevkitError(
    'conflict',
    'SOURCE_OPERATION_INVALID',
    'The recorded commit no longer matches the prepared contribution',
    {
      nextSteps: [
        `git -C ${dir} show --stat ${operation.commit ?? operation.tree}`,
        'Start a separate contribution with --new.',
      ],
    },
  );
}

function snapshotChangedError(dir: string, operation: ContributionOperation): DevkitError {
  return new DevkitError(
    'conflict',
    'SOURCE_SNAPSHOT_CHANGED',
    'Prepared source content changed; review a new contribution',
    {
      nextSteps: [
        `git -C ${dir} diff -- ${operation.paths.join(' ')}`,
        'Contribute the current content with --new.',
      ],
    },
  );
}

export function divergedError(): DevkitError {
  return new DevkitError(
    'conflict',
    'SOURCE_REMOTE_DIVERGED',
    'The contribution branch advanced outside this operation',
    { nextSteps: ['Review the remote branch and use --new for a separate contribution.'] },
  );
}

function associationInvalid(): DevkitError {
  return new DevkitError(
    'conflict',
    'SOURCE_PR_ASSOCIATION_INVALID',
    'The known PR does not match this recorded contribution',
    { nextSteps: ['Verify the PR repository, source branch and target before using --pr.'] },
  );
}
