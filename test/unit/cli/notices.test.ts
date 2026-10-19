// A person reading `fx login` in a terminal learns what a companion advised for a step
// that failed off the terminal, and is not handed fx's generic guidance in its place.
import { expect, it } from 'vitest';

import { stepRecoveryNotices } from '../../../src/cli/notices.js';
import { DevkitError, toEnvelope } from '../../../src/domain/errors.js';

const failure = (code: string, options: { hint?: string; nextSteps?: string[] } = {}) =>
  toEnvelope(new DevkitError('config', code, 'Several stored logins match', options)).error;

it('passes on the recovery a companion gave a failed step, and nothing it did not give', () => {
  expect(
    stepRecoveryNotices([
      {
        id: 'logs-cli.reuse@dev',
        result: 'failed',
        failure: failure('CREDENTIAL_AMBIGUOUS', {
          hint: 'Choose which stored login to reuse.',
          nextSteps: ['logs-cli auth reuse --from-context <name>'],
        }),
      },
      { id: 'logs-cli.login@dev', result: 'failed', failure: failure('SETUP_COMMAND_FAILED') },
      { id: 'logs-cli.credential@dev', result: 'blocked' },
    ]),
  ).toEqual([
    {
      code: 'LOGIN_STEP_FAILED',
      message: 'logs-cli.reuse@dev: Several stored logins match',
      nextSteps: [
        'Choose which stored login to reuse.',
        'logs-cli auth reuse --from-context <name>',
      ],
    },
  ]);
});
