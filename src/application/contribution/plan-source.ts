// Plans read the upstream's committed provider configuration, never unrelated
// dirty configuration in source. Missing base objects produce an honest preview.

import { createHash } from 'node:crypto';

import { scanBoundary } from '../../domain/boundary/scan.js';
import { buildContributionCandidate } from '../../domain/contribution/candidate.js';
import { displayContributionPaths } from '../../domain/contribution/display-paths.js';
import { verifyContributionRemote } from '../../domain/contribution/remote.js';
import { DevkitError } from '../../domain/errors.js';
import { refFromUrl, type RepoRef } from '../../domain/workspace/ref.js';
import type { ContributionUpstream } from '../../ports/contribution-transport.js';

import { planExistingOperation } from './plan-existing.js';
import type {
  PushSourceDeps,
  PushSourceInput,
  PushSourceOutput,
  SourcePlan,
} from './push-types.js';

export interface SourcePlanning {
  readonly deps: PushSourceDeps;
  readonly input: PushSourceInput;
  readonly allocatedId: string;
}

export async function planSource(context: SourcePlanning): Promise<SourcePlan> {
  const { deps, input } = context;
  assertInput(deps, input);
  let plan = await initialPlan(context);
  if (!(await deps.git.inspect({ dir: deps.source.dir, ref: plan.upstream.sha })))
    return finish(plan);
  plan = await connectHost(deps, plan);
  plan = await planExistingOperation({ deps, input, plan });
  if (plan.output.action === 'needs-fetch') plan = await newCandidate(deps, input, plan);
  return finish(plan);
}

async function initialPlan(context: SourcePlanning): Promise<SourcePlan> {
  const { deps, allocatedId } = context;
  const records = await deps.records.read(deps.source.workspace);
  const settings = await deps.transport.inspect(deps.source);
  if (
    settings.originUrls.length !== 1 ||
    settings.pushUrls.length !== 1 ||
    settings.upstreamUrls.length !== 1 ||
    settings.hasRewrite ||
    settings.isMirror ||
    settings.receivePack !== null
  )
    throw new DevkitError(
      'conflict',
      'SOURCE_REMOTE_UNSAFE',
      'Source remotes must identify one origin and upstream without routing overrides.',
    );
  const source = refFromUrl(settings.originUrls[0]!);
  const target = refFromUrl(settings.upstreamUrls[0]!);
  if (!source || !target)
    throw new DevkitError(
      'config',
      'SOURCE_REF_REQUIRED',
      'Source remotes must identify repository references.',
    );
  const upstream = await deps.transport.upstream(deps.source);
  const output = initialOutput({ ...context, upstream, source, target });
  return {
    output,
    allocatedId,
    records,
    settings,
    upstream,
    operation: null,
    snapshot: null,
    remote: null,
    identity: '',
    host: null,
    key: '',
  };
}

function initialOutput({
  deps,
  input,
  allocatedId,
  upstream,
  source,
  target,
}: SourcePlanning & {
  readonly upstream: ContributionUpstream;
  readonly source: RepoRef;
  readonly target: RepoRef;
}): PushSourceOutput {
  return {
    workspace: deps.source.workspace,
    action: 'needs-fetch',
    files: input.paths,
    branch: `fx/contribution/${allocatedId}`,
    base: upstream.sha,
    tree: null,
    commit: null,
    source,
    target,
    target_branch: upstream.branch,
    message: `docs: ${input.issue} ${input.message ?? 'update selected workspace resources'}`,
    title: input.title,
    pull_request: null,
    findings: [],
    validated: false,
    written: false,
    fetched: false,
    retired: [],
  };
}

async function connectHost(deps: PushSourceDeps, plan: SourcePlan): Promise<SourcePlan> {
  const host = deps.hostFor(
    await deps.git.readBase({ dir: deps.source.dir, ref: plan.upstream.sha }),
  );
  if (!host.supportsContributions)
    throw new DevkitError(
      'config',
      'SOURCE_CONTRIBUTION_UNSUPPORTED',
      'The selected code host has no contribution PR service.',
    );
  const origin = await host.repositoryIdentity(refFromUrl(plan.settings.originUrls[0]!)!);
  const official = await host.repositoryIdentity(plan.output.target);
  const remote = verifyContributionRemote({
    settings: plan.settings,
    origin,
    upstream: official,
    user: deps.user ?? (await host.whoami()).user,
    branch: plan.output.branch,
  });
  if (remote.targetBranch !== plan.upstream.branch) throw changed();
  const identity = createHash('sha256').update(JSON.stringify(remote)).digest('hex');
  return {
    ...plan,
    remote,
    identity,
    host,
    output: {
      ...plan.output,
      source: remote.source,
      target: remote.target,
      target_branch: remote.targetBranch,
    },
  };
}

async function newCandidate(
  deps: PushSourceDeps,
  input: PushSourceInput,
  plan: SourcePlan,
): Promise<SourcePlan> {
  const snapshot = await deps.git.capture({
    dir: deps.source.dir,
    base: plan.upstream.sha,
    paths: input.paths,
  });
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
      action: 'create',
      files: displayContributionPaths(snapshot.files.map((file) => file.path)),
      tree: snapshot.tree,
      findings: validation.findings,
      validated: validation.ok,
    },
  };
}

export function finish(plan: SourcePlan): SourcePlan {
  return {
    ...plan,
    key: JSON.stringify({
      output: plan.output,
      records: plan.records,
      identity: plan.identity,
      fingerprint: plan.snapshot?.fingerprint ?? null,
    }),
  };
}

export function changed(): DevkitError {
  return new DevkitError(
    'conflict',
    'SOURCE_PLAN_CHANGED',
    'Source contribution evidence changed after planning.',
    {
      nextSteps: [
        'Re-run the same source push command with --dry-run, then review the updated plan.',
      ],
    },
  );
}

function assertInput(deps: PushSourceDeps, input: PushSourceInput): void {
  if (deps.source.kind !== 'repo')
    throw new DevkitError(
      'config',
      'SOURCE_NOT_GIT',
      'Only a registered Git source can contribute.',
      { nextSteps: ['Register the workspace from its manifest repository URL.'] },
    );
  if (!input.paths.length || !input.issue.trim() || !input.title.trim())
    throw new DevkitError(
      'usage',
      'INPUT_REQUIRED',
      'Select paths and supply an issue ID and PR title.',
    );
  if (
    !/^g-[0-9]+$/.test(input.issue) ||
    /[\r\n]/.test(input.title) ||
    (input.message !== undefined && /[\r\n]/.test(input.message))
  )
    throw new DevkitError(
      'usage',
      'SOURCE_METADATA_INVALID',
      'Use an issue ID and single-line title and commit summary.',
    );
  if (
    scanBoundary({
      text: [...input.paths, input.title, input.message ?? '', input.prRef ?? ''].join('\n'),
      policy: 'manifest',
    }).length
  )
    throw new DevkitError(
      'usage',
      'SOURCE_CONTENT_SENSITIVE',
      'Contribution metadata contains protected content.',
    );
  if (input.forceNew && input.prRef)
    throw new DevkitError(
      'usage',
      'SOURCE_OPTIONS_CONFLICT',
      '--new cannot be combined with --pr.',
    );
}
