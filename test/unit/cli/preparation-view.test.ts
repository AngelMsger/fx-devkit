// A person must be able to tell what is unfinished, sign in and resume from terminal output alone.
import { expect, it } from 'vitest';

import { preparationText } from '../../../src/cli/preparation-view.js';
import { displayOf, PLAIN, type Display } from '../../../src/cli/render/display.js';
import {
  preparation,
  preparationCheck,
  preparationScope,
  type PreparationAction,
} from '../../../src/domain/preparation.js';
import { FakeTerminal, tagged } from '../../fakes/fake-terminal.js';

function action(actor: PreparationAction['actor'], ...argv: readonly string[]): PreparationAction {
  return {
    id: argv.join(' '),
    actor,
    description: 'Sign in with your own account',
    argv,
    cwd: '/work',
    requires_approval: actor === 'user',
  };
}

function view(
  checks: Parameters<typeof preparation>[0]['checks'],
  resume?: PreparationAction,
  display: Display = PLAIN,
): string {
  return preparationText(
    {
      preparation: preparation({
        scope: preparationScope('work'),
        checks,
        ...(resume ? { resume } : {}),
      }),
    },
    { shell: 'posix', display },
  );
}

it('names every blocker and gives one sign-in command per tool, then the continuation', () => {
  const blocked = (id: string, message: string, ...argv: readonly string[]) =>
    preparationCheck(id, 'blocked', message, { owner: 'user', actions: [action('user', ...argv)] });
  const login = ['fx', 'login', 'logs-cli', '--workspace', 'work'];
  const text = view(
    [
      blocked('login:logs-cli.credential@dev', 'exit 1', ...login, '--env', 'dev'),
      blocked('login:logs-cli.credential@test', 'exit 1', ...login, '--env', 'test'),
      blocked('login:chat-cli.access', 'exit 1', 'fx', 'login', 'chat-cli', '--workspace', 'work'),
      preparationCheck('root:notes', 'blocked', 'Stray entry', { required: false }),
    ],
    action('agent', 'node', '/tools with spaces/fx.js', 'init', '--resume', '--workspace', 'work'),
  );
  expect(text.split('\n')[0]).toBe('work needs attention: 3 required checks are not ready');
  expect(text).toContain('  login:logs-cli.credential@dev   exit 1\n');
  expect(text).toContain('  login:chat-cli.access           exit 1\n');
  expect(text).toContain(
    [
      'Run in your terminal:',
      '  fx login logs-cli --workspace work --env dev --env test',
      '  fx login chat-cli --workspace work',
      '',
      'Afterwards:',
      "  node '/tools with spaces/fx.js' init --resume --workspace work",
      '',
      '1 optional check is also pending; --details lists them.',
    ].join('\n'),
  );
});

it('keeps the unselective command when one blocker already covers every environment', () => {
  const login = ['fx', 'login', 'logs-cli', '--workspace', 'work'];
  const text = view([
    preparationCheck('login:a', 'blocked', 'exit 1', {
      actions: [action('user', ...login, '--env', 'dev')],
    }),
    preparationCheck('login:b', 'blocked', 'exit 1', { actions: [action('user', ...login)] }),
  ]);
  expect(text).toContain('Run in your terminal:\n  fx login logs-cli --workspace work\n');
  expect(text).not.toContain('--env');
});

it('offers the repairs fx can make itself as one command', () => {
  const repair = (tool: string) =>
    preparationCheck(`login:${tool}.service`, 'blocked', 'Settings differ', {
      actions: [action('agent', 'fx', 'doctor', '--fix', '--tool', tool, '--workspace', 'work')],
    });
  const text = view([repair('logs-cli'), repair('chat-cli')]);
  expect(text).toContain(
    'fx can repair:\n  fx doctor --fix --workspace work --tool logs-cli --tool chat-cli\n',
  );
  expect(text).not.toContain('Run in your terminal:');
});

it('does not prescribe another setup command after preparation succeeds', () => {
  const text = view([]);
  expect(text).not.toContain('Run in your terminal:');
  expect(text).not.toContain('Afterwards:');
});

it('marks the verdict, each blocker and what to type, wrapping a reason under its own column', () => {
  const reason = 'denied: no credentials are configured for this host in the current environment';
  const blocked = [
    preparationCheck('login:logs-cli', 'blocked', reason, {
      owner: 'user',
      actions: [action('user', 'fx', 'login', 'logs-cli')],
    }),
  ];
  const text = tagged(
    view(blocked, undefined, displayOf(new FakeTerminal(48), {}, 'darwin')),
  ).split('\n');
  expect(text[0]).toBe('<fail>✗</> <strong>work needs attention: 1 required check is not ready</>');
  expect(text.slice(2, 5)).toEqual([
    '  <fail>✗</> <strong>login:logs-cli</>  denied: no credentials are',
    `${' '.repeat(20)}configured for this host in`,
    `${' '.repeat(20)}the current environment`,
  ]);
  expect(text.slice(6, 8)).toEqual([
    '<strong>Run in your terminal:</>',
    '  <accent>fx login logs-cli</>',
  ]);
  expect(view(blocked)).toContain(`  login:logs-cli  ${reason}\n`);
  expect(tagged(view([], undefined, displayOf(new FakeTerminal(), {}, 'darwin')))).toMatch(
    /^<ok>✓<\/> <strong>Required preparation verified: work<\/>\n/,
  );
});
