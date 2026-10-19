// What readiness says when a step's check does not pass: the step is handed over with
// what the check answered, a step waiting on another says so, and a check that could
// not finish is unknown rather than something a person is asked to fix.

import { describe, expect, it, vi } from 'vitest';

import { kubectlProvider } from '../../../../src/adapters/cluster/kubectl/provider.js';
import { Can } from '../../../../src/application/readiness/can.js';
import { Where } from '../../../../src/application/readiness/where.js';
import { DevkitError } from '../../../../src/domain/errors.js';
import type { SetupRecipe } from '../../../../src/domain/setup/types.js';
import type { ProcessResult } from '../../../../src/ports/process.js';
import type { ProviderDescriptor } from '../../../../src/ports/provider.js';
import { fakeLoginDeps } from '../../../fakes/fake-login-deps.js';
import { MANIFEST_DIR, harness, type Harness } from '../../../fakes/workspace.js';

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
  '      jenkins: { vars: { path: "services/{repo}/dev" } }',
  '      kube:',
  '        vars: { kubeconfig: ~/.kube/dev.yaml, context: dev }',
  '        setup: { source: "https://console.example.com/" }',
].join('\n');

// `quota` waits on `token` here; a case may make it wait on `role` as well.
const recipe = (id: string, requires: readonly string[] = []): SetupRecipe => ({
  id,
  tool: 'jenkins-cli',
  perEnv: false,
  kind: 'manual',
  title: `Confirm ${id}`,
  verify: { command: ['check', id] },
  requires,
});
const DESCRIPTORS: Record<string, ProviderDescriptor<unknown>> = {
  kubectl: kubectlProvider,
  'jenkins-cli': {
    id: 'jenkins-cli',
    capability: 'ci',
    tools: ['jenkins-cli'],
    recipes: [recipe('role'), recipe('token'), recipe('quota', ['token'])],
    vars: [],
    create: () => ({}),
  },
};

const PASSED: ProcessResult = { code: 0, stdout: '', stderr: '' };
const timedOut = (binary: string): DevkitError =>
  new DevkitError('internal', 'PROCESS_TIMEOUT', `${binary} did not finish within 30000ms`);

async function stage(): Promise<Harness> {
  const h = await harness({
    workspace: WORKSPACE,
    files: { [`${MANIFEST_DIR}/manifest/environments.yaml`]: ENVIRONMENTS },
  });
  for (const binary of ['kubectl', 'jenkins-cli']) h.process.binaries.add(binary);
  h.process
    .on(['kubectl', 'version'], { code: 0, stdout: 'Client Version: v9.0.0', stderr: '' })
    .on(['jenkins-cli', '--version'], { code: 0, stdout: 'jenkins-cli 9.0.0', stderr: '' });
  return h;
}

// Every kubectl call after the version probe: the kubeconfig check, then the access one.
function cluster(h: Harness, answers: { kubeconfig?: ProcessResult; access: ProcessResult }): void {
  h.process
    .when((v) => v[0] === 'kubectl' && v.includes('get-contexts'), answers.kubeconfig ?? PASSED)
    .when((v) => v[0] === 'kubectl' && v.includes('can-i'), answers.access);
}

// Lets one check outlive its deadline, the way the process port reports it.
function hang(h: Harness, matches: (vector: readonly string[]) => boolean, error: DevkitError) {
  const run = h.process.run.bind(h.process);
  vi.spyOn(h.process, 'run').mockImplementation(async (vector, options) => {
    if (matches(vector)) throw error;
    return run(vector, options);
  });
}

const can = (h: Harness, target: string) =>
  new Can(h.deps, fakeLoginDeps(DESCRIPTORS)).execute({ target, env: 'dev' });

describe('a check that does not pass', () => {
  it('hands the step over with what its check answered and the recovery its recipe reads', async () => {
    const h = await stage();
    cluster(h, {
      access: {
        code: 1,
        stdout: '',
        stderr: 'Error from server (Forbidden): User "system:unauthenticated" cannot get resource',
      },
    });
    expect(await can(h, 'cluster')).toMatchObject({
      status: 'unconfigured',
      handoff: {
        user_steps: [
          {
            id: 'kubectl.access@dev',
            instructions: expect.stringContaining('Authentication was not established'),
            open: 'https://console.example.com/',
            check: {
              result: 'failed',
              cause: 'credential',
              detail: expect.stringContaining('system:unauthenticated'),
            },
          },
        ],
        command: 'fx login kubectl --env dev --workspace fx',
      },
    });
  });

  it('keeps the step own guidance and the tool own words for a failure it cannot read', async () => {
    const h = await stage();
    const stderr = 'Unable to connect to the server: x509: certificate signed by unknown authority';
    cluster(h, { access: { code: 1, stdout: '', stderr } });
    const result = await can(h, 'cluster');
    expect(result.handoff?.user_steps).toEqual([
      {
        id: 'kubectl.access@dev',
        kind: 'manual',
        title: 'Confirm read access to dev',
        instructions: 'The check asks the cluster whether you may get pods in default.',
        check: { result: 'failed', detail: stderr },
      },
    ]);
  });

  it('says which step another one waits on, and does not ask the cluster in the meantime', async () => {
    const h = await stage();
    cluster(h, {
      kubeconfig: { code: 1, stdout: '', stderr: 'error: context dev not found' },
      access: PASSED,
    });
    expect((await can(h, 'cluster')).handoff?.user_steps).toMatchObject([
      {
        id: 'kubectl.kubeconfig@dev',
        open: 'https://console.example.com/',
        expects: { path: '~/.kube/dev.yaml' },
        check: { result: 'failed', detail: 'error: context dev not found' },
      },
      { id: 'kubectl.access@dev', check: { result: 'blocked', by: 'kubectl.kubeconfig@dev' } },
    ]);
    expect(h.process.calls.some((call) => call.vector.includes('can-i'))).toBe(false);
  });

  it('is unknown when the check could not finish, and hands nobody a step', async () => {
    const h = await stage();
    cluster(h, { access: PASSED });
    hang(h, (vector) => vector.includes('can-i'), timedOut('kubectl'));
    expect(await can(h, 'cluster')).toMatchObject({
      status: 'unknown',
      unfinished: [
        {
          id: 'kubectl.access@dev',
          code: 'PROCESS_TIMEOUT',
          message: 'kubectl did not finish within 30000ms',
        },
      ],
      handoff: {
        summary: 'Could not finish checking kubectl.access@dev',
        user_steps: [],
        command: 'fx doctor --tool kubectl --env dev --workspace fx',
      },
    });
  });

  it('is unknown, not a step for anyone, when the tool behind the check does not start', async () => {
    const h = await stage();
    cluster(h, {
      kubeconfig: {
        code: 127,
        stdout: '',
        stderr: 'command not found: kubectl',
        notStarted: true,
      },
      access: PASSED,
    });
    expect(await can(h, 'cluster')).toMatchObject({
      status: 'unknown',
      unfinished: [{ id: 'kubectl.kubeconfig@dev', code: 'TOOL_MISSING' }],
      handoff: { user_steps: [] },
    });
    expect(h.process.calls.some((call) => call.vector.includes('can-i'))).toBe(false);
  });

  it('keeps a failure it did establish when another check could not finish', async () => {
    const h = await stage();
    h.process
      .on(['jenkins-cli', 'check', 'role'], { code: 1, stdout: '', stderr: 'role missing' })
      .on(['jenkins-cli', 'check', 'quota'], PASSED);
    hang(h, (vector) => vector.includes('token'), timedOut('jenkins-cli'));
    const result = await can(h, 'ci');
    expect(result).toMatchObject({
      status: 'unconfigured',
      unfinished: [{ id: 'jenkins-cli.token', code: 'PROCESS_TIMEOUT' }],
    });
    expect(result.handoff?.user_steps.map((step) => step.id)).toEqual(['jenkins-cli.role']);
    expect(h.process.calls.some((call) => call.vector.includes('quota'))).toBe(false);
  });

  it.each([[['role', 'token']], [['token', 'role']]])(
    'does not hand over a step that waits on an unfinished check and a failed one: %j',
    async (requires) => {
      const h = await stage();
      h.process.on(['jenkins-cli', 'check', 'role'], {
        code: 1,
        stdout: '',
        stderr: 'role missing',
      });
      hang(h, (vector) => vector.includes('token'), timedOut('jenkins-cli'));
      const jenkins = DESCRIPTORS['jenkins-cli']!;
      const descriptors = {
        ...DESCRIPTORS,
        'jenkins-cli': {
          ...jenkins,
          recipes: [recipe('role'), recipe('token'), recipe('quota', requires)],
        },
      };
      const result = await new Can(h.deps, fakeLoginDeps(descriptors)).execute({
        target: 'ci',
        env: 'dev',
      });
      expect(result.handoff?.user_steps.map((step) => step.id)).toEqual(['jenkins-cli.role']);
      expect(result.unfinished).toMatchObject([{ id: 'jenkins-cli.token' }]);
    },
  );

  it('still fails when fx itself was interrupted', async () => {
    const h = await stage();
    cluster(h, { access: PASSED });
    hang(
      h,
      (vector) => vector.includes('can-i'),
      new DevkitError('internal', 'PROCESS_ABORTED', 'kubectl was given up on'),
    );
    await expect(can(h, 'cluster')).rejects.toMatchObject({ code: 'PROCESS_ABORTED' });
  });

  it('answers for the other platforms of a repository when one check could not finish', async () => {
    const h = await stage();
    cluster(h, { access: PASSED });
    for (const id of ['role', 'token', 'quota']) h.process.on(['jenkins-cli', 'check', id], PASSED);
    hang(h, (vector) => vector.includes('can-i'), timedOut('kubectl'));
    const rows = await new Where(h.deps, fakeLoginDeps(DESCRIPTORS)).execute({
      repo: 'fx-example-api',
      env: 'dev',
      check: true,
      probe: false,
    });
    expect(rows.map((row) => `${row.platform}:${row.ready}`)).toEqual([
      'kube:unknown',
      'jenkins:ready',
    ]);
    expect(rows[0]).toMatchObject({ unfinished: [{ id: 'kubectl.access@dev' }] });
    expect(rows[1]).not.toHaveProperty('unfinished');
  });
});
