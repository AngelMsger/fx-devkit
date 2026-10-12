import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { TemplatePlatform } from '../../../src/adapters/platform/template-platform.js';
import { Where } from '../../../src/application/where.js';
import { describeProvider } from '../../../src/composition/registry.js';
import type { LocalLayer } from '../../../src/domain/manifest/types.js';
import { shellLine } from '../../../src/domain/shell.js';
import type { Platform } from '../../../src/ports/platform.js';
import type { ProviderDescriptor } from '../../../src/ports/provider.js';
import { fakeLoginDeps } from '../../fakes/fake-login-deps.js';
import { MANIFEST_DIR, harness } from '../../fakes/workspace.js';

const fixture = (name: string): string =>
  readFileSync(path.resolve('test/fixtures/manifest/v1-real-shape', name), 'utf8');

const jenkins = new TemplatePlatform({
  id: 'jenkins-cli',
  capability: 'ci',
  label: 'job {path}',
  command: ['jenkins-cli', 'build', 'list', '{path}'],
  probe: { label: 'job {path}', command: ['jenkins-cli', 'job', 'get', '{path}'] },
});
// The fixture's environments bind the bundled platform providers; only the CI one is
// replaced, so its coordinates stay a template this test controls.
const DESCRIPTORS: Record<string, ProviderDescriptor<unknown>> = {
  ...Object.fromEntries(
    ['sentry', 'openobserve-cli', 'kubectl'].map((id) => [id, describeProvider(id)!]),
  ),
  'jenkins-cli': {
    id: 'jenkins-cli',
    capability: 'ci',
    tools: ['jenkins-cli'],
    recipes: [],
    vars: [],
    create: () => jenkins,
  },
};
const LOOKUP = { check: false, probe: false } as const;

async function stage(local: LocalLayer = {}) {
  const h = await harness({
    workspace: fixture('workspace.yaml'),
    files: {
      [`${MANIFEST_DIR}/manifest/environments.yaml`]: fixture('environments.yaml'),
    },
    local,
    platforms: { 'jenkins-cli': jenkins },
  });
  return { h, where: new Where(h.deps, fakeLoginDeps(DESCRIPTORS)) };
}

describe('Where', () => {
  it('uses an unpicked repository alias only to locate canonical coordinates', async () => {
    const h = await harness({
      workspace: fixture('workspace.yaml').replace(
        '  - name: fx-example-api\n',
        '  - name: fx-example-api\n    aka: [backend]\n',
      ),
      files: { [`${MANIFEST_DIR}/manifest/environments.yaml`]: fixture('environments.yaml') },
      local: { scope: { repos: [] } },
      platforms: { 'jenkins-cli': jenkins },
    });
    const [row] = await new Where(h.deps, fakeLoginDeps(DESCRIPTORS)).execute({
      repo: 'backend',
      env: 'dev',
      platform: 'jenkins',
      ...LOOKUP,
    });
    expect(row).toMatchObject({
      repo: 'fx-example-api',
      command: 'jenkins-cli job get services/fx-example-api/feature%2Fdev',
    });
    expect(h.localStore.writes).toEqual([]);
    expect(h.process.calls).toEqual([]);
  });

  it.each([false, true])(
    'expands provider home paths without a shell and preserves manifest shell templates: %s',
    async (customTemplate) => {
      const kube = new TemplatePlatform({
        id: 'kubectl',
        capability: 'cluster',
        label: 'pods',
        command: ['kubectl', '--kubeconfig', '{kubeconfig}', 'get', 'pods'],
        probe: {
          label: 'pods',
          command: ['kubectl', '--kubeconfig', '{kubeconfig}', 'get', 'pods'],
        },
      });
      const manifestCommand = 'kubectl --kubeconfig ~/.kube/config.dev get pods';
      const h = await harness({
        workspace:
          'schema_version: 2\ndefaults: { branch: dev }\nrepos: [{ name: fx-example-api, upstream: "https://git.example.com/fx/fx-example-api.git" }]\n',
        files: {
          [`${MANIFEST_DIR}/manifest/environments.yaml`]: [
            'schema_version: 2',
            'platforms:',
            '  kube:',
            '    provider: kubectl',
            '    capability: cluster',
            ...(customTemplate ? [`    command: ${manifestCommand}`] : []),
            'envs:',
            '  dev:',
            '    platforms:',
            '      kube: { vars: { kubeconfig: "~/.kube/config.dev" } }',
          ].join('\n'),
        },
        platforms: { kubectl: kube },
      });
      const home = path.resolve('/home/Example User');
      const vector = [
        'kubectl',
        '--kubeconfig',
        path.join(home, '.kube/config.dev'),
        'get',
        'pods',
      ];
      h.process.on(vector, { code: 0, stdout: '{}', stderr: '' });
      const where = new Where(h.deps, { ...fakeLoginDeps({}), home });
      const [row] = await where.execute({
        repo: 'fx-example-api',
        env: 'dev',
        platform: 'kube',
        check: false,
        probe: true,
      });
      expect(h.process.calls.map((call) => call.vector)).toEqual([vector]);
      const expanded = shellLine(vector);
      expect(row).toMatchObject({
        command: customTemplate ? manifestCommand : expanded,
        probed: expanded,
        outcome: 'reachable',
      });
    },
  );

  it('prints a PromQL selector for a registered scrape job and never guesses or probes one', async () => {
    const prometheus = describeProvider('prometheus-cli')!;
    const h = await harness({
      workspace: [
        'schema_version: 2',
        'defaults: { branch: dev }',
        'repos:',
        '  - name: fx-example-api',
        '    upstream: https://git.example.com/fx/fx-example-api.git',
        '    obs: { overrides: { metrics: { test: { vars: { job: example-api } } } } }',
        '  - name: fx-example-auth',
        '    upstream: https://git.example.com/fx/fx-example-auth.git',
      ].join('\n'),
      files: {
        [`${MANIFEST_DIR}/manifest/environments.yaml`]: [
          'schema_version: 2',
          'platforms:',
          '  metrics: { provider: prometheus-cli, capability: metrics }',
          'envs:',
          '  test:',
          '    platforms:',
          '      metrics:',
          '        service: { base_url: "https://metrics.example.com", context: test, auth_scheme: none }',
        ].join('\n'),
      },
      platforms: { 'prometheus-cli': prometheus.create({} as never, {}) as Platform },
    });
    const where = new Where(h.deps, fakeLoginDeps({ 'prometheus-cli': prometheus }));
    const lookup = { env: 'test', platform: 'metrics', check: false } as const;
    const [registered] = await where.execute({ repo: 'fx-example-api', probe: true, ...lookup });
    expect(registered).toMatchObject({
      label: 'Prometheus job example-api',
      command:
        'prometheus-cli query instant --use-context test --query \'up{job="example-api"}\' --base-url https://metrics.example.com --auth-scheme none',
      outcome: 'unknown',
      probed: null,
      suggested_confidence: null,
      detail: 'prometheus-cli offers no probe',
    });
    const [unregistered] = await where.execute({
      repo: 'fx-example-auth',
      probe: false,
      ...lookup,
    });
    expect(unregistered).toMatchObject({
      status: 'located',
      command: null,
      notes: ['Missing coordinate variables: job'],
    });
    expect(h.process.calls).toEqual([]);
  });

  it('does not dispatch a probe containing an unresolved coordinate variable', async () => {
    const s = await stage();
    const incomplete = new TemplatePlatform({
      id: 'jenkins-cli',
      capability: 'ci',
      label: 'job',
      command: ['jenkins-cli', 'job', 'get', '{missing_path}'],
      probe: { label: 'job', command: ['jenkins-cli', 'job', 'get', '{missing_path}'] },
    });
    const where = new Where(
      { ...s.h.deps, platform: () => incomplete },
      fakeLoginDeps(DESCRIPTORS),
    );
    const [row] = await where.execute({
      repo: 'fx-example-api',
      env: 'dev',
      platform: 'jenkins',
      check: false,
      probe: true,
    });
    expect(row).toMatchObject({
      outcome: 'unknown',
      probed: null,
      suggested_confidence: null,
      detail: 'Missing coordinate variables: missing_path',
    });
    expect(s.h.process.calls).toEqual([]);
  });

  it('locates unpicked repositories from manifest overrides without selecting or cloning them', async () => {
    const local: LocalLayer = {
      scope: { repos: [] },
      overrides: { 'fx-example-data': { path: 'personal/data', branch: 'feature/local' } },
    };
    const s = await stage(local);
    const [prod] = await s.where.execute({
      repo: 'fx-example-data',
      env: 'prod',
      platform: 'sentry',
      ...LOOKUP,
    });
    expect(prod).toMatchObject({
      status: 'located',
      vars: { slug: 'fx-example-data-prod' },
      confidence: 'verified',
      command: 'sentry issue list fx/fx-example-data-prod --query is:unresolved --json',
    });
    const [dev] = await s.where.execute({
      repo: 'fx-example-data',
      env: 'dev',
      platform: 'sentry',
      ...LOOKUP,
    });
    expect(dev?.vars).toMatchObject({ slug: 'fx-example-data-dev' });
    const [uncovered] = await s.where.execute({
      repo: 'fx-example-legacy',
      env: 'prod',
      platform: 'sentry',
      ...LOOKUP,
    });
    expect(uncovered).toMatchObject({ status: 'not_covered', command: null });
    expect(s.h.ctx.local).toEqual(local);
    expect(s.h.ctx.workspace.repos).toEqual([]);
    expect(s.h.localStore.writes).toEqual([]);
    expect(s.h.git.checkouts.size).toBe(0);
    expect(s.h.git.calls).toEqual([]);
    expect(s.h.process.calls).toEqual([]);
    await expect(s.where.execute({ repo: 'unknown', ...LOOKUP })).rejects.toMatchObject({
      category: 'not_found',
      code: 'REPO_NOT_FOUND',
    });
  });

  it('lists every platform of every environment in scope; without --check nothing runs', async () => {
    const s = await stage({ scope: { envs: ['dev', 'selfhosted'] } });
    const rows = await s.where.execute({ repo: 'fx-example-api', ...LOOKUP });
    expect(rows.map((c) => `${c.env}/${c.platform}:${c.status}`)).toEqual([
      'dev/sentry:located',
      'dev/openobserve:located',
      'dev/jenkins:located',
      'dev/kube:located',
      'selfhosted/sentry:located',
      'selfhosted/openobserve:not_covered',
      'selfhosted/jenkins:located',
      'selfhosted/kube:not_covered',
    ]);
    expect(rows.every((r) => r.ready === null && r.handoff === null)).toBe(true);
    expect(s.h.process.calls).toEqual([]);
  });

  it('fills the ready column per platform, and skips the check where nothing is covered', async () => {
    const s = await stage({ scope: { envs: ['dev', 'selfhosted'] } });
    s.h.process.when((v) => v[1] === '--version', { code: 0, stdout: 'x 9.0.0', stderr: '' });
    s.h.process.binaries.add('jenkins-cli');
    const rows = await s.where.execute({ repo: 'fx-example-api', check: true, probe: false });
    expect(rows.map((r) => `${r.env}/${r.platform}:${r.ready}`)).toEqual([
      'dev/sentry:missing_tool',
      'dev/openobserve:missing_tool',
      'dev/jenkins:ready',
      'dev/kube:missing_tool',
      'selfhosted/sentry:missing_tool',
      'selfhosted/openobserve:not_covered',
      'selfhosted/jenkins:ready',
      'selfhosted/kube:not_covered',
    ]);
    expect(rows[0]?.handoff).toMatchObject({ command: 'fx tool install sentry --workspace fx' });
    expect(rows[2]?.handoff).toBeNull();
    expect(
      s.h.process.calls.map((c) => c.vector[0]),
      'the check only asks the tools; no coordinate command runs',
    ).not.toContain('jenkins-cli build');
    expect(
      s.h.process.calls.filter((call) => call.vector.join(' ') === 'jenkins-cli --version'),
    ).toHaveLength(1);
  });

  it('preserves version-check recovery on a located coordinate without running its query', async () => {
    const s = await stage();
    s.h.process.binaries.add('jenkins-cli');
    s.h.process.when((v) => v[1] === '--version', {
      code: 1,
      stdout: 'runtime 24.14.0',
      stderr: 'startup failed',
    });
    const [row] = await s.where.execute({
      repo: 'fx-example-api',
      env: 'dev',
      platform: 'jenkins',
      check: true,
      probe: false,
    });
    expect(row).toMatchObject({
      status: 'located',
      ready: 'unknown',
      handoff: {
        command: 'fx doctor --tool jenkins-cli --workspace fx',
        user_steps: [{ instructions: expect.stringContaining('jenkins-cli --version') }],
      },
    });
    expect(s.h.process.calls.map((call) => call.vector)).toEqual([['jenkins-cli', '--version']]);
  });

  it('probes coordinates concurrently up to --jobs and preserves manifest order', async () => {
    const platforms = Array.from({ length: 12 }, (_, index) => `builds-${index}`);
    const environments = [
      'schema_version: 2',
      'platforms:',
      ...platforms.map(
        (platform) =>
          `  ${platform}: { provider: jenkins-cli, capability: ci, vars: { host: jenkins.example.com } }`,
      ),
      'envs:',
      '  dev:',
      '    platforms:',
      ...platforms.map((platform) => `      ${platform}: { vars: { path: "${platform}/{repo}" } }`),
    ].join('\n');
    const h = await harness({
      workspace: [
        'schema_version: 2',
        'providers: { code-host: { provider: local-git, vars: { host: /host } } }',
        'defaults: { upstream_project: fx, branch: main }',
        'repos: [{ name: fx-example-api, obs: { svc: example-api } }]',
      ].join('\n'),
      files: { [`${MANIFEST_DIR}/manifest/environments.yaml`]: environments },
      platforms: { 'jenkins-cli': jenkins },
    });
    let inFlight = 0;
    let peak = 0;
    const deps = {
      ...h.deps,
      processRun: async (vector: readonly string[], options = {}) => {
        inFlight += 1;
        peak = Math.max(peak, inFlight);
        await new Promise((resolve) => setTimeout(resolve, 2));
        inFlight -= 1;
        return h.process.run(vector, options);
      },
    };
    h.process.always({ code: 0, stdout: '{}', stderr: '' });

    const rows = await new Where(deps, fakeLoginDeps(DESCRIPTORS)).execute({
      repo: 'fx-example-api',
      env: 'dev',
      check: false,
      probe: true,
      jobs: 3,
    });

    expect(peak).toBe(3);
    expect(rows.map((row) => row.platform)).toEqual(platforms);
  });

  it('narrows to one environment and platform, and answers a typo with a suggestion', async () => {
    const s = await stage();
    const [one] = await s.where.execute({
      repo: 'fx-example-api',
      env: 'prod',
      platform: 'jenkins',
      ...LOOKUP,
    });
    expect(one?.command).toBe('jenkins-cli job get services/fx-example-api/master');
    await expect(
      s.where.execute({ repo: 'fx-example-api', platform: 'jenkin', ...LOOKUP }),
    ).rejects.toMatchObject({ code: 'PLATFORM_NOT_FOUND', hint: 'Did you mean "jenkins"?' });
    await expect(
      s.where.execute({ repo: 'fx-example-api', env: 'prd', ...LOOKUP }),
    ).rejects.toMatchObject({ code: 'ENV_NOT_FOUND', hint: 'Did you mean "prod"?' });
    await expect(s.where.execute({ repo: 'fx-example-ap', ...LOOKUP })).rejects.toMatchObject({
      code: 'REPO_NOT_FOUND',
    });
  });

  it("with --probe runs the provider's read-only probe and classifies the family exit code", async () => {
    const s = await stage();
    await expect(
      s.where.execute({ repo: 'fx-example-api', check: false, probe: true }),
    ).rejects.toMatchObject({ code: 'ENV_REQUIRED', category: 'usage' });
    s.h.process.on(['jenkins-cli', 'job', 'get', 'services/fx-example-api/master'], {
      code: 0,
      stdout: '{}',
      stderr: '',
    });
    s.h.process.on(['jenkins-cli', 'job', 'get'], { code: 6, stdout: '', stderr: 'job not found' });
    const rows = await s.where.execute({
      repo: 'fx-example-api',
      env: 'prod',
      check: false,
      probe: true,
    });
    expect(rows.map((r) => [r.platform, r.outcome, r.suggested_confidence])).toEqual([
      ['sentry', 'unknown', null],
      ['openobserve', 'unknown', null],
      ['jenkins', 'reachable', 'verified'],
      ['kube', 'unknown', null],
    ]);
    const [missing] = await s.where.execute({
      repo: 'fx-example-data',
      env: 'prod',
      platform: 'jenkins',
      check: false,
      probe: true,
    });
    expect(missing).toMatchObject({
      outcome: 'missing',
      detail: 'job not found',
      suggested_confidence: 'not_found',
    });
    s.h.process.clear().on(['jenkins-cli'], {
      code: 4,
      stdout: '',
      stderr:
        '{"_notice":{"code":"X","message":"n"}}\n{"error":{"code":"E","message":"unauthorized"}}\n',
    });
    const [auth] = await s.where.execute({
      repo: 'fx-example-api',
      env: 'prod',
      platform: 'jenkins',
      check: false,
      probe: true,
    });
    expect(auth).toMatchObject({ outcome: 'unauthorized', detail: 'unauthorized' });
  });
});
