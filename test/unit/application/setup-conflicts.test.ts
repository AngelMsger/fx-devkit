import path from 'node:path';

import { expect, it } from 'vitest';

import { kubectlProvider } from '../../../src/adapters/cluster/kubectl/provider.js';
import { checkLogin } from '../../../src/application/doctor/login.js';
import { Login } from '../../../src/application/login/run.js';
import { Readiness } from '../../../src/application/readiness.js';
import { report } from '../../../src/domain/report.js';
import { fakeLoginDeps } from '../../fakes/fake-login-deps.js';
import { harness, MANIFEST_DIR } from '../../fakes/workspace.js';

it('never certifies either platform from a colliding setup plan', async () => {
  const h = await harness({
    workspace:
      'schema_version: 2\nproviders: {code-host: {provider: local-git, vars: {host: /host}}}\ndefaults: {upstream_project: fx, branch: main}\nrepos: [{name: sample}]\n',
    files: {
      [`${MANIFEST_DIR}/manifest/environments.yaml`]: [
        'schema_version: 2',
        'platforms:',
        '  alpha: {provider: kubectl, capability: cluster}',
        '  beta: {provider: kubectl, capability: cluster}',
        'envs:',
        '  test:',
        '    platforms:',
        '      alpha: {vars: {kubeconfig: /alpha, context: alpha}}',
        '      beta: {vars: {kubeconfig: /beta, context: beta}}',
      ].join('\n'),
      [path.resolve('/alpha')]: 'first cluster is configured',
    },
  });
  h.process.binaries.add('kubectl');
  h.process.when((vector) => vector[0] === 'kubectl', { code: 0, stdout: 'v1.30.0', stderr: '' });
  const login = fakeLoginDeps({ kubectl: kubectlProvider });
  await expect(
    new Login(h.deps, login).execute({
      tools: ['kubectl'],
      envs: ['test'],
      skipManual: false,
      dryRun: false,
      noInput: true,
      posture: { readOnly: false, source: 'default' },
    }),
  ).rejects.toMatchObject({ code: 'SETUP_PLAN_CONFLICT' });
  expect(h.localStore.writes).toEqual([]);
  expect(h.process.calls).toEqual([]);
  const readiness = new Readiness(h.deps, login);
  for (const binding of h.deps.ctx.platforms) {
    const target = readiness.targetOf(binding);
    expect(target).not.toBeNull();
    expect(await readiness.judge(target!, 'test')).toMatchObject({ status: 'unconfigured' });
  }
  const findings = await checkLogin(h.deps, login, { tools: ['kubectl'], envs: ['test'] });
  expect(report(['login'], findings)).toMatchObject({ ok: true, complete: false });
  expect(findings).toHaveLength(2);
  expect(h.process.calls.every((call) => call.vector.includes('version'))).toBe(true);
});
