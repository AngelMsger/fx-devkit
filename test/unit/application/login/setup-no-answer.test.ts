// Preparation for a setup check that gave no answer: the check is an agent's to unblock,
// the step waiting on it is nobody's yet, and neither hands a person a sign-in.

import { expect, it } from 'vitest';

import { kubectlProvider } from '../../../../src/adapters/cluster/kubectl/provider.js';
import { prepareWorkspaceSetup } from '../../../../src/application/login/stage.js';
import { workspacePreparation } from '../../../../src/application/preparation.js';
import { DevkitError } from '../../../../src/domain/errors.js';
import type { SetupRecipe } from '../../../../src/domain/setup/types.js';
import { fakeLoginDeps } from '../../../fakes/fake-login-deps.js';
import { MANIFEST_DIR, harness } from '../../../fakes/workspace.js';

const WORKSPACE =
  'schema_version: 2\ndefaults: { branch: dev }\nrepos: [{ name: fx-example-api, upstream: "https://git.example.com/fx/fx-example-api.git" }]\n';
const ENVIRONMENTS = [
  'schema_version: 2',
  'platforms:',
  '  kube: { provider: kubectl, capability: cluster }',
  '  jenkins: { provider: jenkins-cli, capability: ci }',
  'envs:',
  '  dev:',
  '    platforms:',
  '      kube: { vars: { kubeconfig: ~/.kube/dev.yaml, context: dev } }',
  '      jenkins: { vars: { path: "services/{repo}/dev" } }',
].join('\n');
const POSTURE = { readOnly: false, source: 'default' } as const;

const manual = (id: string, requires: readonly string[] = []): SetupRecipe => ({
  id,
  tool: 'jenkins-cli',
  perEnv: false,
  kind: 'manual',
  title: `Confirm ${id}`,
  verify: { command: ['check', id] },
  requires,
});

it.each([true, false])(
  'leaves a check whose tool could not start to an agent, and its dependant to nobody (initializing: %s)',
  async (initializing) => {
    const h = await harness({
      workspace: WORKSPACE,
      files: { [`${MANIFEST_DIR}/manifest/environments.yaml`]: ENVIRONMENTS },
    });
    h.process.on(['kubectl'], {
      code: 127,
      stdout: '',
      stderr: 'command not found: kubectl\n',
      notStarted: true,
    });
    const stage = await prepareWorkspaceSetup(h.deps, fakeLoginDeps({ kubectl: kubectlProvider }), {
      initializing,
      dryRun: false,
      posture: POSTURE,
    });
    const inspect = {
      actor: 'agent',
      argv: ['fx', 'tool', 'install', 'kubectl', '--workspace', 'fx', '--dry-run'],
      requires_approval: false,
    };
    const checks = Object.fromEntries(stage.checks.map((check) => [check.id, check]));
    expect(checks['login:kubectl.kubeconfig@dev']).toMatchObject({
      state: 'unknown',
      owner: 'agent',
      actions: [inspect],
    });
    expect(checks['login:kubectl.access@dev']).toMatchObject({
      state: 'unknown',
      owner: 'agent',
      actions: [],
    });
    const preparation = workspacePreparation(h.deps, { stages: ['setup'], checks: stage.checks });
    expect(preparation.next.kind).toBe('act');
    expect(preparation.next_actions).toMatchObject([inspect]);
    expect(h.process.calls.some((call) => call.vector.includes('can-i'))).toBe(false);
  },
);

it('keeps a step from a person when it waits on a failed check and an unanswered one', async () => {
  const h = await harness({
    workspace: WORKSPACE,
    files: { [`${MANIFEST_DIR}/manifest/environments.yaml`]: ENVIRONMENTS },
  });
  h.process
    .on(['jenkins-cli', 'check', 'role'], { code: 1, stdout: '', stderr: 'role missing' })
    .on(
      ['jenkins-cli', 'check', 'token'],
      new DevkitError('internal', 'PROCESS_TIMEOUT', 'jenkins-cli did not finish'),
    )
    .when((vector) => vector[0] !== 'jenkins-cli', { code: 0, stdout: 'dev', stderr: '' });
  const login = fakeLoginDeps({
    kubectl: kubectlProvider,
    'jenkins-cli': {
      id: 'jenkins-cli',
      capability: 'ci',
      tools: ['jenkins-cli'],
      // The failed check is listed first; the unanswered one still decides whose the step is.
      recipes: [manual('role'), manual('token'), manual('quota', ['role', 'token'])],
      vars: [],
      create: () => ({}),
    },
  });
  const stage = await prepareWorkspaceSetup(h.deps, login, {
    initializing: true,
    dryRun: false,
    posture: POSTURE,
  });
  const checks = Object.fromEntries(stage.checks.map((check) => [check.id, check]));
  expect(checks['login:jenkins-cli.role']).toMatchObject({ state: 'blocked', owner: 'user' });
  expect(checks['login:jenkins-cli.token']).toMatchObject({
    state: 'unknown',
    owner: 'agent',
    actions: [{ argv: ['fx', 'doctor', '--tool', 'jenkins-cli', '--workspace', 'fx'] }],
  });
  expect(checks['login:jenkins-cli.quota']).toMatchObject({
    state: 'unknown',
    owner: 'agent',
    actions: [],
  });
});
