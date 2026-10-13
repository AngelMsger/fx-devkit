// Contributions on GitHub through `gh api`: the repository identity a fork is verified
// against, one known pull request, and opening one. Each answer is projected with --jq,
// so only the fields read here cross the pipe, and a response that does not name the
// repositories and branches fx asked about is refused rather than trusted.

import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import {
  assertPullRequestText,
  type ContributionPullRequest,
  type CreatePullRequest,
  type PullRequestBranch,
  type PullRequestLookup,
} from '../../../domain/contribution/pull-request.js';
import type { RepositoryIdentity } from '../../../domain/contribution/remote.js';
import type { RepoRef } from '../../../ports/code-host.js';
import { EXIT, objectOf, stringAt } from '../../family/cli.js';
import {
  callContribution,
  contributionFailed,
  identityIncomplete,
  pullRequestReferenceInvalid,
  pullRequestResponseInvalid,
  pullRequestWebUrl,
} from '../../family/contribution.js';
import { BINARY, type CliCall } from '../../github/gh.js';

// One `gh api` request against the binding's host: the endpoint and the flags before it.
export type GhApi = (endpoint: string, args: readonly string[]) => Promise<CliCall>;

const REPOSITORY =
  '{full_name, owner_type: .owner.type, default_branch, clone_url, ssh_url, fork, parent: .parent.full_name}';
const PULL_REQUEST =
  '{number, html_url, state, merged, head: {ref: .head.ref, repo: .head.repo.full_name}, base: {ref: .base.ref, repo: .base.repo.full_name}}';

export async function readRepositoryIdentity(
  api: GhApi,
  ref: RepoRef,
): Promise<RepositoryIdentity> {
  const call = await contribute(() => api(`repos/${slug(ref)}`, ['--jq', REPOSITORY]));
  if (call.code !== 0) throw contributionFailed(BINARY, call);
  const data = objectOf(call.data);
  const identity = data === undefined ? undefined : refOf(stringAt(data, 'full_name'));
  if (data === undefined || identity === undefined || !sameName(identity, ref))
    throw identityIncomplete();
  const advertised = [stringAt(data, 'ssh_url'), stringAt(data, 'clone_url')].filter(
    (url): url is string => url !== undefined,
  );
  const defaultBranch = stringAt(data, 'default_branch');
  if (advertised.length === 0 || !defaultBranch) throw identityIncomplete();
  return {
    ref: identity,
    cloneUrls: [...advertised, ...spelledAs(advertised, identity, ref)],
    defaultBranch,
    // An organization's repository is nobody's personal fork.
    personalOwner: stringAt(data, 'owner_type') === 'User' ? identity.project : null,
    parent: parentOf(data),
  };
}

export async function readPullRequest(
  api: GhApi,
  web: string,
  input: PullRequestLookup,
): Promise<ContributionPullRequest | null> {
  const id = pullRequestNumber(input.id, web);
  const call = await contribute(() =>
    api(`repos/${slug(input.repo)}/pulls/${id}`, ['--jq', PULL_REQUEST]),
  );
  if (call.code === EXIT.not_found) return null;
  if (call.code !== 0) throw contributionFailed(BINARY, call);
  const result = decodePullRequest(call.data);
  if (result.id !== id || !sameRef(result.target.repo, input.repo))
    throw pullRequestResponseInvalid();
  return result;
}

// The request body goes through a private file, so the description keeps its exact bytes
// and neither it nor the title is on a command line.
export async function createPullRequest(
  api: GhApi,
  input: CreatePullRequest,
): Promise<ContributionPullRequest> {
  assertPullRequestText(input);
  const directory = await fs.mkdtemp(path.join(tmpdir(), 'fx-contribution-pr-'));
  const file = path.join(directory, 'request.json');
  try {
    const request = {
      title: input.title,
      body: input.description,
      // A fork's branch is named by its owner; GitHub finds the fork in the upstream's network.
      head: `${input.source.repo.project}:${input.source.branch}`,
      base: input.target.branch,
    };
    await fs.writeFile(file, JSON.stringify(request), { mode: 0o600 });
    const call = await contribute(() =>
      api(`repos/${slug(input.target.repo)}/pulls`, [
        '--method',
        'POST',
        '--input',
        file,
        '--jq',
        PULL_REQUEST,
      ]),
    );
    if (call.code !== 0) throw contributionFailed(BINARY, call);
    const result = decodePullRequest(call.data);
    if (
      result.state !== 'open' ||
      !sameBranch(result.source, input.source) ||
      !sameBranch(result.target, input.target)
    )
      throw pullRequestResponseInvalid();
    return result;
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
}

function contribute(run: () => Promise<CliCall>): Promise<CliCall> {
  return callContribution(BINARY, run);
}

// A number, or the pull request's page on this repository's own website.
function pullRequestNumber(reference: string, web: string): string {
  if (/^[1-9][0-9]*$/.test(reference)) return reference;
  const supplied = pullRequestWebUrl(reference);
  const repository = pullRequestWebUrl(web);
  const match = /^(.*)\/pull\/([1-9][0-9]*)(?:\/(?:files|commits|checks))?\/?$/.exec(
    supplied.pathname,
  );
  // GitHub answers to any letter case of an owner and a repository name.
  if (
    match === null ||
    supplied.origin !== repository.origin ||
    match[1]!.toLowerCase() !== repository.pathname.replace(/\/+$/, '').toLowerCase()
  )
    throw pullRequestReferenceInvalid();
  return match[2]!;
}

function decodePullRequest(value: unknown): ContributionPullRequest {
  const data = objectOf(value);
  const id = data?.['number'];
  const url = data === undefined ? undefined : stringAt(data, 'html_url');
  if (
    data === undefined ||
    typeof id !== 'number' ||
    !Number.isSafeInteger(id) ||
    id < 1 ||
    url === undefined ||
    !/^https?:\/\//.test(url)
  )
    throw pullRequestResponseInvalid();
  return {
    id: String(id),
    url,
    state: stateOf(stringAt(data, 'state'), data['merged']),
    source: decodeBranch(data['head']),
    target: decodeBranch(data['base']),
  };
}

// GitHub closes a pull request whether it was merged or turned down; `merged` tells which.
function stateOf(state: string | undefined, merged: unknown): ContributionPullRequest['state'] {
  if (state === 'open') return 'open';
  if (state === 'closed' && typeof merged === 'boolean') return merged ? 'merged' : 'declined';
  throw pullRequestResponseInvalid();
}

// A fork deleted after its pull request leaves no repository to name, and no identity to
// check the pull request against.
function decodeBranch(value: unknown): PullRequestBranch {
  const data = objectOf(value);
  const branch = data === undefined ? undefined : stringAt(data, 'ref');
  const repo = data === undefined ? undefined : refOf(stringAt(data, 'repo'));
  if (!branch || repo === undefined) throw pullRequestResponseInvalid();
  return { branch, repo };
}

// undefined: a fork whose parent GitHub did not name; null: not a fork.
function parentOf(data: Record<string, unknown>): RepoRef | null | undefined {
  if (data['fork'] !== true) return null;
  const parent = stringAt(data, 'parent');
  if (parent === undefined) return undefined;
  const ref = refOf(parent);
  if (ref === undefined) throw identityIncomplete();
  return ref;
}

// GitHub answers to any letter case of an owner and a repository name, so a remote that
// spells them differently from the API names the same repository. Its spelling is
// advertised beside the API's, or the remote checks would refuse a valid fork.
function spelledAs(urls: readonly string[], identity: RepoRef, ref: RepoRef): string[] {
  const answered = `${slug(identity)}.git`;
  const written = `${slug(ref)}.git`;
  if (answered === written) return [];
  return urls
    .filter((url) => url.endsWith(answered))
    .map((url) => `${url.slice(0, -answered.length)}${written}`);
}

function refOf(fullName: string | undefined): RepoRef | undefined {
  const parts = fullName?.split('/');
  if (parts?.length !== 2 || !parts[0] || !parts[1]) return undefined;
  return { project: parts[0], name: parts[1] };
}

function sameName(a: RepoRef, b: RepoRef): boolean {
  return slug(a).toLowerCase() === slug(b).toLowerCase();
}

function sameRef(a: RepoRef, b: RepoRef): boolean {
  return a.project === b.project && a.name === b.name;
}

function sameBranch(a: PullRequestBranch, b: PullRequestBranch): boolean {
  return a.branch === b.branch && sameRef(a.repo, b.repo);
}

function slug(ref: RepoRef): string {
  return `${ref.project}/${ref.name}`;
}
