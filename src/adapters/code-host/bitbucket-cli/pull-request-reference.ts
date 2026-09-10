// URL associations are resolved against the current repository's native web
// address. Only a canonical repository/ID vector reaches the companion query.

import type { PullRequestLookup } from '../../../domain/contribution/pull-request.js';
import { DevkitError } from '../../../domain/errors.js';
import { objectOf, stringAt } from '../../family/cli.js';

import type { BitbucketCli } from './client.js';
import { callContribution, contributionFailed } from './contribution-call.js';

interface ReferenceInput {
  readonly cli: BitbucketCli;
  readonly input: PullRequestLookup;
}

export async function resolvePullRequestId({ cli, input }: ReferenceInput): Promise<string> {
  if (/^[1-9][0-9]*$/.test(input.id)) return input.id;
  const supplied = webUrl(input.id);
  const match =
    /^(.*)\/pull-requests\/([1-9][0-9]*)(?:\/(?:overview|diff|commits|activity))?\/?$/.exec(
      supplied.pathname,
    );
  if (!match) throw invalidReference();
  const call = await callContribution({
    cli,
    args: ['repo', 'get', `${input.repo.project}/${input.repo.name}`],
  });
  if (call.code !== 0) throw contributionFailed(call);
  const address = stringAt(objectOf(call.data) ?? {}, 'url');
  if (!address) throw invalidReference();
  const canonical = webUrl(address);
  const base = canonical.pathname.replace(/\/browse\/?$/, '').replace(/\/$/, '');
  if (canonical.origin !== supplied.origin || base !== match[1]) throw invalidReference();
  return match[2]!;
}

function webUrl(value: string): URL {
  try {
    const url = new URL(value);
    if (['http:', 'https:'].includes(url.protocol) && !url.username && !url.password && !url.search)
      return url;
  } catch {
    /* Invalid references are reported without echoing their values. */
  }
  throw invalidReference();
}

function invalidReference(): DevkitError {
  return new DevkitError(
    'usage',
    'SOURCE_PR_REFERENCE_INVALID',
    'Use a PR ID or a PR URL belonging to the current repository website.',
    {
      nextSteps: [
        'Verify the current repository and PR, then pass its ID or canonical URL to --pr.',
      ],
    },
  );
}
