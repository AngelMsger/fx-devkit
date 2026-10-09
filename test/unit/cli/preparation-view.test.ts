// A person must be able to finish sign-in and resume directly from terminal output.
import { expect, it } from 'vitest';

import { preparationText } from '../../../src/cli/preparation-view.js';
import {
  preparation,
  preparationCheck,
  preparationScope,
  type PreparationAction,
} from '../../../src/domain/preparation.js';

it('prints personal sign-in once and the continuation command without requiring JSON', () => {
  const login: PreparationAction = {
    id: 'login:account',
    actor: 'user',
    description: 'Sign in with your own account',
    argv: ['fx', 'login', 'example-cli', '--workspace', 'work'],
    cwd: '/work',
    requires_approval: true,
  };
  const resume: PreparationAction = {
    ...login,
    id: 'resume',
    actor: 'agent',
    argv: ['node', '/tools with spaces/fx.js', 'init', '--resume', '--workspace', 'work'],
    requires_approval: false,
  };
  const result = preparation({
    scope: preparationScope('work'),
    checks: ['first', 'second'].map((id) =>
      preparationCheck(id, 'blocked', 'Personal sign-in is needed', {
        owner: 'user',
        actions: [login],
      }),
    ),
    resume,
  });
  const text = preparationText({ preparation: result }, 'posix');
  expect(result.next.kind).toBe('handoff');
  expect(result.next_actions).toEqual([]);
  expect(text.match(/fx login example-cli --workspace work/g)).toHaveLength(1);
  expect(text).toContain('Sign in with your own account');
  expect(text).toContain(
    "continue: node '/tools with spaces/fx.js' init --resume --workspace work",
  );
});

it('does not prescribe another setup command after preparation succeeds', () => {
  const text = preparationText(
    { preparation: preparation({ scope: preparationScope('work'), checks: [] }) },
    'posix',
  );
  expect(text).not.toContain('Run in your terminal:');
  expect(text).not.toContain('continue:');
});
