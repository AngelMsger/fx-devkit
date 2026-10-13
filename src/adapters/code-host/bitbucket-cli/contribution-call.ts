// Contribution calls through bitbucket-cli; the failure rules are every code host's.

import type { DevkitError } from '../../../domain/errors.js';
import {
  callContribution as familyCall,
  contributionFailed as failed,
} from '../../family/contribution.js';

import { BINARY, type BitbucketCli, type CliCall } from './client.js';

interface ContributionCall {
  readonly cli: BitbucketCli;
  readonly args: readonly string[];
}

export function callContribution({ cli, args }: ContributionCall): Promise<CliCall> {
  return familyCall(BINARY, () => cli.call(args, { timeoutMs: 15000 }));
}

export function contributionFailed(call: CliCall): DevkitError {
  return failed(BINARY, call);
}
