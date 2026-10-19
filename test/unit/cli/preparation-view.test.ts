// A person must be able to tell what is unfinished, sign in and resume from terminal output alone.
import { expect, it } from 'vitest';

import type {
  InitOutput,
  InitResources,
  PlannedSetupStep,
} from '../../../src/application/init/types.js';
import type { StepRow } from '../../../src/application/login/run.js';
import type { StageDetails, SyncItem } from '../../../src/application/sync/types.js';
import type { ToolInstallOutput } from '../../../src/application/tool/install.js';
import { preparationText } from '../../../src/cli/preparation-view.js';
import { displayOf, PLAIN, type Display } from '../../../src/cli/render/display.js';
import { DevkitError, toEnvelope } from '../../../src/domain/errors.js';
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

it('names what is blocked once per cause and gives one sign-in command per tool, then the continuation', () => {
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
  expect(text.split('\n')[0]).toBe(
    'work needs attention: 3 required checks are not ready, in 2 groups',
  );
  expect(text).toContain('  login:logs-cli.credential@dev (+1 more)  exit 1\n');
  expect(text).toContain('  login:chat-cli.access                    exit 1\n');
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

it('keeps apart a check that could not run and asks nobody to sign in for it', () => {
  const login = action('user', 'fx', 'login', 'logs-cli', '--workspace', 'work');
  const checks = [
    preparationCheck('login:logs-cli.credential', 'blocked', 'HTTP 401', { actions: [login] }),
    ...['dev', 'test'].map((env) =>
      preparationCheck(`login:cluster.access@${env}`, 'unknown', 'did not finish within 30000ms', {
        actions: [],
      }),
    ),
  ];
  const text = tagged(view(checks, undefined, displayOf(new FakeTerminal(), {}, 'darwin')));
  expect(text).toContain('  <fail>✗</> <strong>login:logs-cli.credential</>');
  expect(text).toContain(
    '  <quiet>→</> <strong>login:cluster.access@dev (+1 more)</>  did not finish within 30000ms',
  );
  expect(view(checks)).toContain('Run in your terminal:\n  fx login logs-cli --workspace work\n');
  expect(view(checks)).not.toContain('cluster --');
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

const install = (vector: readonly string[] | null): ToolInstallOutput => ({
  name: 'logs-cli',
  via: 'npm',
  vector,
  docs: null,
  ran: false,
  code: null,
  version_after: null,
});

const step = (
  phase: PlannedSetupStep['phase'],
  command: readonly string[] | null,
  verify: PlannedSetupStep['verify'],
): PlannedSetupStep => ({
  id: `logs-cli.${phase}`,
  tool: 'logs-cli',
  phase,
  title: phase,
  action: phase === 'prepare' ? 'prepare_if_needed' : 'verify_only',
  command,
  cwd: '/work',
  verify,
  requires: [],
});

const standing = {
  manifest: '/fx/source',
  registration: '/fx/config.yaml',
  personal_selection: null,
  workspace_guides: '/work',
  agent_resources: 'Skills and rules',
  services: 'Public settings',
  global_tools: 'Opted-in tools',
};

function initialization(
  resources: InitResources,
  inspected: boolean,
): Pick<InitOutput, 'root' | 'manifest_dir' | 'plan'> {
  return {
    root: '/work',
    manifest_dir: '/fx/source',
    plan: {
      source_inspected: inspected,
      inspected_source: inspected ? '/fx/source' : null,
      manifest_action: 'materialize',
      registration: 'register',
      default_workspace: 'set',
      selection: { mode: 'all', repos: null, validated: inspected },
      repositories: inspected
        ? [
            { name: 'api', path: 'api', branch: 'main', action: 'clone', fetch: false },
            { name: 'web', path: 'web', branch: 'main', action: 'clone', fetch: false },
            { name: 'docs', path: 'docs', branch: 'main', action: 'skip_unpicked', fetch: false },
          ]
        : null,
      resources,
      unchecked: [],
    },
  };
}

const planned = preparation({ scope: preparationScope('work'), checks: [], preview: true });

it('previews what an initialization installs, replaces and runs, naming each command once', () => {
  const status = { command: ['logs-cli', 'auth', 'status'] };
  const text = preparationText(
    {
      preparation: planned,
      ...initialization(
        {
          ...standing,
          guide_conflicts: [
            { path: '/work/AGENTS.md', action: 'requires_replacement_approval', backup: 'kept' },
          ],
          tools: [{ name: 'logs-cli', action: 'install_if_missing', scope: 'global', methods: [] }],
          tool_checks: [{ name: 'logs-cli', command: ['logs-cli', '--version'] }],
          setup: [
            step('prepare', ['logs-cli', 'config', 'init'], status),
            step('authenticate', ['logs-cli', 'auth', 'login'], status),
            step('manual', null, { file: '~/.kube/dev' }),
          ],
          preparation: {
            root: '/work',
            source: '/fx/source',
            note: 'No trust is granted.',
            tool_install: [install(['npm', 'install', '-g', 'logs-cli']), install(null)],
            skills: {
              links: [],
              fx: [],
              tools: [
                {
                  tool: 'logs-cli',
                  vector: ['logs-cli', 'skill', 'install'],
                  code: null,
                  origin: 'base',
                },
              ],
              summary: {},
            },
            services: { checks: [], summary: {} },
          },
        },
        true,
      ),
    },
    { shell: 'posix', display: PLAIN },
  );
  expect(text.split('\n')).toEqual([
    'Preparation preview; no changes made: /work',
    'Repositories: 2 selected (2 clone)',
    'Install if missing: logs-cli',
    'Prepare the workspace guides and selected Agent Skills.',
    'Replacement approval: /work/AGENTS.md; preserve a backup.',
    'Review command: npm install -g logs-cli',
    'Review command: logs-cli skill install',
    'Review command: logs-cli --version',
    'Review command: logs-cli config init',
    'Review command: logs-cli auth status',
    '',
  ]);
});

it('says what each stage did under the verdict, leaving out what says nothing happened', () => {
  const repo = (name: string, extra: Pick<SyncItem, 'action' | 'result'> & Partial<SyncItem>) => ({
    name,
    path: name,
    branch: 'main',
    fetch: false,
    ...extra,
  });
  const synced = {
    preparation: preparation({ scope: preparationScope('work'), checks: [] }),
    items: [
      repo('api', { action: 'fast_forward', result: 'done', outcome: 'updated' }),
      repo('web', { action: 'fast_forward', result: 'done', outcome: 'up_to_date' }),
      repo('new', { action: 'fast_forward', result: 'skipped', outcome: 'empty_remote' }),
      repo('spare', { action: 'skip_unpicked', result: 'skipped' }),
      repo('fx-workspace', {
        action: 'skip_manifest',
        result: 'skipped',
        reason: 'kept as it is: on chore/x, not main; its commits are already in upstream/main',
      }),
    ],
    stages: {
      docs: { created: 0, updated: 0, unchanged: 1 },
      skills: { unchanged: 3, tools_run: 7, tools_failed: 0 },
    },
  };
  const text = preparationText(synced, { shell: 'posix', display: PLAIN });
  expect(text.split('\n')).toEqual([
    'Required preparation verified: work',
    'Scope: ',
    'Repositories  3: 1 updated, 1 up to date, 1 skipped (new)',
    'Manifest      kept as it is: on chore/x, not main; its commits are already in upstream/main',
    'Skills        7 tools run',
    '',
  ]);
});

it('says so when the source of a previewed initialization has not been read', () => {
  const text = preparationText(
    { preparation: planned, ...initialization(standing, false) },
    { shell: 'posix', display: PLAIN },
  );
  expect(text.split('\n')).toEqual([
    'Preparation preview; no changes made: /work',
    'Repositories: 0 selected',
    'Prepare the workspace guides and selected Agent Skills.',
    'The source has not been inspected; its requirements will be validated before preparation.',
    '',
  ]);
});

it('names the setup steps of a first sync whose check passes, and none of a setup that failed', () => {
  const row = (title: string, result: StepRow['result']): StepRow => ({
    id: title,
    tool: 'logs-cli',
    env: null,
    kind: 'run',
    title,
    result,
    detail: null,
  });
  const ready = preparation({ scope: preparationScope('work'), checks: [] });
  const after = (setup: NonNullable<StageDetails['setup']>): string =>
    preparationText(
      {
        preparation: ready,
        root: '/work',
        manifest_dir: '/fx/source',
        sync: {
          operation: 'apply',
          items: [],
          summary: { done: 0, skipped: 0, failed: 0, unreadable: 0 },
          stages: {},
          stage_details: { setup },
        },
      },
      { shell: 'posix', display: PLAIN },
    );
  const items = [
    row('Prepare local files', 'done'),
    row('Log in', 'verified'),
    row('Add a token', 'handoff'),
  ];
  expect(after({ items, problems: [] })).toBe(
    'Ready to work: /work\nSetup already verified: Prepare local files, Log in\n',
  );
  const failure = toEnvelope(new DevkitError('config', 'SETUP_PLAN_INVALID', 'Invalid plan')).error;
  expect(after({ failure })).toBe('Ready to work: /work\n');
});

it('groups blockers by what the person is to do and names a waiting check under its cause', () => {
  const login = action('user', 'fx', 'login', 'logs-cli', '--workspace', 'work', '--env', 'dev');
  const recheck = action('user', 'fx', 'doctor', '--tool', 'metrics-cli', '--env', 'test');
  const text = view([
    preparationCheck('login:logs-cli.reuse@dev', 'blocked', 'Reuse: no stored login is visible', {
      code: 'CREDENTIAL_NOT_VISIBLE_OR_MISSING',
      failure: {
        category: 'config',
        code: 'CREDENTIAL_NOT_VISIBLE_OR_MISSING',
        message: 'no stored login is visible',
        hint: 'Retry with access to the host keychain.',
        next_steps: [],
        retryable: false,
      },
    }),
    preparationCheck('login:logs-cli.credential@dev', 'blocked', 'Sign in: reuse@dev is not done', {
      waits_on: 'login:logs-cli.reuse@dev',
      actions: [login],
    }),
    preparationCheck('login:logs-cli.credential@prod', 'blocked', 'Sign in: HTTP 401', {
      cause: 'credential',
      actions: [login],
    }),
    preparationCheck('login:metrics-cli.access@test', 'blocked', 'Reach: request failed', {
      cause: 'network',
      actions: [recheck],
    }),
  ]);
  expect(text.split('\n')[0]).toBe(
    'work needs attention: 4 required checks are not ready, in 3 groups',
  );
  expect(text).toContain(
    [
      'Sign-in or credentials:',
      '  login:logs-cli.credential@prod  Sign in: HTTP 401',
      'Not reachable from this machine:',
      '  login:metrics-cli.access@test   Reach: request failed',
      'Other:',
      '  login:logs-cli.reuse@dev        Reuse: no stored login is visible (CREDENTIAL_NOT_VISIBLE_OR_MISSING)',
      '                                  holds back login:logs-cli.credential@dev',
    ].join('\n'),
  );
});
