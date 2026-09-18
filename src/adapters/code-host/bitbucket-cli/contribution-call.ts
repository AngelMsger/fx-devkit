// Contribution calls retain family status categories but never echo server
// messages that may contain submitted text. Tool/auth failures carry a handoff.

import { DevkitError } from '../../../domain/errors.js';
import { EXIT, queryFailed } from '../../family/cli.js';

import { BINARY, type BitbucketCli, type CliCall } from './client.js';

interface ContributionCall {
  readonly cli: BitbucketCli;
  readonly args: readonly string[];
}

export async function callContribution({ cli, args }: ContributionCall): Promise<CliCall> {
  try {
    const call = await cli.call(args, { timeoutMs: 15000 });
    if (call.code === EXIT.auth)
      throw prerequisite('LOGIN_REQUIRED', 'Sign in to the code host', `fx login ${BINARY}`);
    return call;
  } catch (error) {
    if (error instanceof DevkitError && error.code === 'TOOL_MISSING')
      throw prerequisite(
        'TOOL_MISSING',
        'Install the code-host companion CLI',
        `fx tool install ${BINARY}`,
      );
    throw error;
  }
}

export function contributionFailed(call: CliCall): DevkitError {
  return queryFailed(
    BINARY,
    { ...call, data: undefined, stdout: '', error: undefined },
    'complete the contribution request',
  );
}

function prerequisite(code: string, title: string, command: string): DevkitError {
  return new DevkitError(code === 'LOGIN_REQUIRED' ? 'auth' : 'config', code, title, {
    nextSteps: [command],
    handoff: {
      summary: title,
      command,
      userSteps: [{ id: 'source-code-host', kind: 'manual', title }],
    },
  });
}
