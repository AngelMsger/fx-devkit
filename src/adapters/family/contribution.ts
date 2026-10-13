// What every code host's contribution calls share. They keep the family's status
// categories but never echo a server message, which may quote the submitted text; a
// missing tool or sign-in carries a handoff. A response that does not prove the identity
// fx asked about is refused with the same codes whichever companion sent it.

import { DevkitError } from '../../domain/errors.js';

import { EXIT, queryFailed, type CliCall } from './cli.js';

export async function callContribution(
  binary: string,
  run: () => Promise<CliCall>,
): Promise<CliCall> {
  try {
    const call = await run();
    if (call.code === EXIT.auth)
      throw prerequisite('LOGIN_REQUIRED', 'Sign in to the code host', `fx login ${binary}`);
    return call;
  } catch (error) {
    if (error instanceof DevkitError && error.code === 'TOOL_MISSING')
      throw prerequisite(
        'TOOL_MISSING',
        'Install the code-host companion CLI',
        `fx tool install ${binary}`,
      );
    throw error;
  }
}

export function contributionFailed(binary: string, call: CliCall): DevkitError {
  return queryFailed(
    binary,
    { ...call, data: undefined, stdout: '', error: undefined },
    'complete the contribution request',
  );
}

export function identityIncomplete(): DevkitError {
  return new DevkitError(
    'config',
    'SOURCE_IDENTITY_UNVERIFIED',
    'The companion did not return a complete matching repository identity',
    { nextSteps: ['fx doctor', 'Update the code-host companion and verify repository access.'] },
  );
}

export function pullRequestResponseInvalid(): DevkitError {
  return new DevkitError(
    'server',
    'SOURCE_PR_RESPONSE_INVALID',
    'The companion did not return the expected pull request identity',
    {
      hint: 'Creation may have succeeded; inspect the remote before attempting another create.',
      nextSteps: [
        'Inspect the known PR in the code host.',
        'Associate its verified ID with --pr instead of blindly retrying creation.',
      ],
    },
  );
}

export function pullRequestReferenceInvalid(): DevkitError {
  return new DevkitError(
    'usage',
    'SOURCE_PR_REFERENCE_INVALID',
    'Use a PR ID or a PR URL belonging to the current repository website',
    {
      nextSteps: [
        'Verify the current repository and PR, then pass its ID or canonical URL to --pr.',
      ],
    },
  );
}

// A reference the person typed is reported without echoing it back.
export function pullRequestWebUrl(value: string): URL {
  try {
    const url = new URL(value);
    if (['http:', 'https:'].includes(url.protocol) && !url.username && !url.password && !url.search)
      return url;
  } catch {
    /* Invalid references are reported without echoing their values. */
  }
  throw pullRequestReferenceInvalid();
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
