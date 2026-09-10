// PR creation preserves exact description bytes in a private temporary file.
// Remote responses must identify the requested source and destination before use.

import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { scanBoundary } from '../../../domain/boundary/scan.js';
import type {
  ContributionPullRequest,
  CreatePullRequest,
  PullRequestBranch,
  PullRequestLookup,
} from '../../../domain/contribution/pull-request.js';
import { DevkitError } from '../../../domain/errors.js';
import { EXIT, objectOf, stringAt } from '../../family/cli.js';

import type { BitbucketCli } from './client.js';
import { callContribution, contributionFailed } from './contribution-call.js';
import { resolvePullRequestId } from './pull-request-reference.js';

interface PullRequestRead {
  readonly cli: BitbucketCli;
  readonly input: PullRequestLookup;
}
interface PullRequestCreate {
  readonly cli: BitbucketCli;
  readonly input: CreatePullRequest;
}

export async function readContributionPullRequest({
  cli,
  input,
}: PullRequestRead): Promise<ContributionPullRequest | null> {
  const id = await resolvePullRequestId({ cli, input });
  const call = await callContribution({
    cli,
    args: ['pr', 'get', `${input.repo.project}/${input.repo.name}/${id}`, '--scope', 'summary'],
  });
  if (call.code === EXIT.not_found) return null;
  if (call.code !== 0) throw contributionFailed(call);
  const result = decodePullRequest(call.data);
  if (
    result.id !== id ||
    result.target.repo.project !== input.repo.project ||
    result.target.repo.name !== input.repo.name
  )
    throw invalidResponse();
  return result;
}

export async function createContributionPullRequest({
  cli,
  input,
}: PullRequestCreate): Promise<ContributionPullRequest> {
  if (scanBoundary({ text: `${input.title}\n${input.description}`, policy: 'manifest' }).length)
    throw new DevkitError(
      'usage',
      'SOURCE_CONTENT_SENSITIVE',
      'The PR text contains protected content.',
    );
  const directory = await fs.mkdtemp(path.join(tmpdir(), 'fx-contribution-pr-'));
  const file = path.join(directory, 'description.md');
  try {
    await fs.writeFile(file, input.description, { mode: 0o600 });
    const args = [
      'pr',
      'create',
      '--repo',
      `${input.target.repo.project}/${input.target.repo.name}`,
      '--source-repo',
      `${input.source.repo.project}/${input.source.repo.name}`,
      '--source',
      input.source.branch,
      '--target',
      input.target.branch,
      '--title',
      input.title,
      '--description-file',
      file,
    ];
    if (input.allowWrites) args.push('--allow-writes');
    const call = await callContribution({ cli, args });
    if (call.code !== 0) throw contributionFailed(call);
    const result = decodePullRequest(call.data);
    if (
      result.state !== 'open' ||
      !sameBranch(result.source, input.source) ||
      !sameBranch(result.target, input.target)
    )
      throw invalidResponse();
    return result;
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
}

function decodePullRequest(value: unknown): ContributionPullRequest {
  const data = objectOf(value);
  const id = data?.['id'];
  const url = data && stringAt(data, 'url');
  const state = data && stringAt(data, 'state')?.toLowerCase();
  if (
    !data ||
    typeof id !== 'number' ||
    !Number.isSafeInteger(id) ||
    id < 1 ||
    !url ||
    !/^https?:\/\//.test(url)
  )
    throw invalidResponse();
  if (state !== 'open' && state !== 'merged' && state !== 'declined' && state !== 'superseded')
    throw invalidResponse();
  return {
    id: String(id),
    url,
    state,
    source: decodeBranch(data['source']),
    target: decodeBranch(data['destination']),
  };
}

function decodeBranch(value: unknown): PullRequestBranch {
  const data = objectOf(value);
  const branch = data && stringAt(data, 'branch');
  const repository = data && stringAt(data, 'repository');
  const segments = repository?.split('/');
  if (!branch || !segments || segments.length !== 2 || !segments[0] || !segments[1])
    throw invalidResponse();
  return { branch, repo: { project: segments[0], name: segments[1] } };
}

function sameBranch(a: PullRequestBranch, b: PullRequestBranch): boolean {
  return a.branch === b.branch && a.repo.project === b.repo.project && a.repo.name === b.repo.name;
}

function invalidResponse(): DevkitError {
  return new DevkitError(
    'server',
    'SOURCE_PR_RESPONSE_INVALID',
    'The companion did not return the expected pull request identity.',
    {
      hint: 'Creation may have succeeded; inspect the remote before attempting another create.',
      nextSteps: [
        'Inspect the known PR in the code host.',
        'Associate its verified ID with --pr instead of blindly retrying creation.',
      ],
    },
  );
}
