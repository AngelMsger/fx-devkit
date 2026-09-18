// Native normalized repository records supply clone identity and fork evidence.
// Older companions omit parentage; that absence remains unknown to the caller.

import type { RepositoryIdentity } from '../../../domain/contribution/remote.js';
import { DevkitError } from '../../../domain/errors.js';
import type { Branch, RepoRef } from '../../../ports/code-host.js';
import { objectOf, stringAt } from '../../family/cli.js';

import type { BitbucketCli } from './client.js';
import { callContribution, contributionFailed } from './contribution-call.js';

interface IdentityRead {
  readonly cli: BitbucketCli;
  readonly ref: RepoRef;
  readonly branches: () => Promise<Branch[]>;
}

export async function readRepositoryIdentity({
  cli,
  ref,
  branches,
}: IdentityRead): Promise<RepositoryIdentity> {
  const call = await callContribution({ cli, args: ['repo', 'get', `${ref.project}/${ref.name}`] });
  if (call.code !== 0) throw contributionFailed(call);
  const data = objectOf(call.data);
  if (!data) throw invalidIdentity();
  const identity = decodeRepoRef(data);
  if (identity.project.toLowerCase() !== ref.project.toLowerCase() || identity.name !== ref.name)
    throw invalidIdentity();
  const cloneUrls = [stringAt(data, 'clone_ssh'), stringAt(data, 'clone_https')].filter(
    (url): url is string => url !== undefined,
  );
  const defaultBranch =
    stringAt(data, 'default_branch') ??
    stringAt(data, 'main_branch') ??
    (await branches()).find((branch) => branch.default)?.name;
  if (cloneUrls.length === 0 || !defaultBranch) throw invalidIdentity();
  const parent = decodeParent(data);
  return {
    ref: identity,
    cloneUrls,
    defaultBranch,
    personalOwner: identity.project.startsWith('~') ? identity.project.slice(1) : null,
    parent,
  };
}

function decodeParent(data: Record<string, unknown>): RepoRef | null | undefined {
  if (!('parent' in data)) return undefined;
  if (data['parent'] === null) return null;
  const parent = objectOf(data['parent']);
  if (!parent) throw invalidIdentity();
  return decodeRepoRef(parent);
}

export function decodeRepoRef(data: Record<string, unknown>): RepoRef {
  const project = stringAt(data, 'workspace');
  const name = stringAt(data, 'slug');
  if (!project || !name) throw invalidIdentity();
  return { project, name };
}

function invalidIdentity(): DevkitError {
  return new DevkitError(
    'config',
    'SOURCE_IDENTITY_UNVERIFIED',
    'The companion did not return a complete matching repository identity',
    { nextSteps: ['fx doctor', 'Update the code-host companion and verify repository access.'] },
  );
}
