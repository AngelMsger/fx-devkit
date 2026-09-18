import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { providerCatalog } from '../../../../src/composition/registry.js';
import { loadEnvironments, loadWorkspace } from '../../../../src/domain/manifest/loader.js';
import { applyLocal, type ResolvedRepo } from '../../../../src/domain/manifest/local.js';
import { bindPlatforms } from '../../../../src/domain/manifest/providers.js';
import { weakest } from '../../../../src/domain/obs/confidence.js';
import { locateRepo, serviceOf } from '../../../../src/domain/obs/coordinate.js';

const text = (name: string): string =>
  readFileSync(path.resolve('test/fixtures/manifest/v1-real-shape', name), 'utf8');
const cli = { cliVersion: '1.0.0' };
const workspace = loadWorkspace(text('workspace.yaml'), cli).doc;
const environments = loadEnvironments(text('environments.yaml'), cli, { workspace }).doc;
const bindings = bindPlatforms(environments, providerCatalog());
const repos = applyLocal(workspace, {}).repos;
const repo = (name: string): ResolvedRepo => repos.find((r) => r.name === name)!;
const binding = (platform: string) => bindings.find((b) => b.platform === platform);

describe('locateRepo', () => {
  it.each([{}, { path: 'services/{missing_branch}' }])(
    'withholds a manifest command when its variables remain unresolved: %j',
    (vars) => {
      const c = locateRepo({
        repo: repo('fx-example-api'),
        env: 'dev',
        platform: 'jenkins',
        environments: {
          ...environments,
          envs: { dev: { platforms: { jenkins: { vars } } } },
        },
        binding: binding('jenkins'),
      });
      expect(c.command).toBeNull();
      expect(c.status).toBe('located');
      expect(c.notes).toContain(
        `Missing coordinate variables: ${'path' in vars ? 'missing_branch' : 'path'}`,
      );
    },
  );

  it.each(['', '   '])(
    'withholds a command when an override clears a default coordinate: %j',
    (path) => {
      const original = repo('fx-example-api');
      const c = locateRepo({
        repo: {
          ...original,
          obs: { ...original.obs, overrides: { jenkins: { dev: { vars: { path } } } } },
        },
        env: 'dev',
        platform: 'jenkins',
        environments,
        binding: binding('jenkins'),
      });
      expect(c.command).toBeNull();
      expect(c.notes).toContain('Missing coordinate variables: path');
    },
  );

  it('withholds an unresolved provider command and names its missing variables', () => {
    const c = locateRepo({
      repo: repo('fx-example-api'),
      env: 'dev',
      platform: 'jenkins',
      environments: {
        ...environments,
        platforms: { ...environments.platforms, jenkins: {} },
      },
      binding: binding('jenkins'),
      locate: () => ({ label: 'job', command: ['jenkins-cli', 'job', 'get', '{missing_path}'] }),
    });
    expect(c.command).toBeNull();
    expect(c.notes).toContain('Missing coordinate variables: missing_path');
  });

  it('merges platform, environment and override variables, substitutes the built-ins, and fills the manifest template', () => {
    const c = locateRepo({
      repo: repo('fx-example-data'),
      env: 'prod',
      platform: 'sentry',
      environments,
      binding: binding('sentry'),
    });
    expect(c).toMatchObject({
      status: 'located',
      provider: 'sentry',
      capability: 'error-tracker',
      label: 'Sentry',
      command: 'sentry issue list fx/fx-example-data-prod --query is:unresolved --json',
      confidence: 'verified',
      vars: {
        host: 'sentry.example.com',
        org: 'fx',
        team: 'fx',
        slug: 'fx-example-data-prod',
        svc: 'example-data',
        repo: 'fx-example-data',
        env: 'prod',
      },
    });
    expect(c.notes).toEqual(['production projects are shared across teams']);

    const dev = locateRepo({
      repo: repo('fx-example-api'),
      env: 'dev',
      platform: 'openobserve',
      environments,
      binding: binding('openobserve'),
    });
    expect(dev.command).toBe(
      'openobserve-cli search run --use-context dev --stream fx_example-api_dev',
    );
    expect(dev.confidence, 'nothing declared: derived').toBe('derived');
    expect(dev.notes).toEqual(['shared by everyone; expect noise']);
  });

  it('takes the weakest declared confidence and orders notes from specific to general', () => {
    const c = locateRepo({
      repo: repo('fx-example-api'),
      env: 'selfhosted',
      platform: 'sentry',
      environments,
      binding: binding('sentry'),
    });
    expect(c.confidence).toBe('unverified');
    expect(c.notes).toEqual([
      'customer-operated',
      'no central log store',
      'production projects are shared across teams',
    ]);
    expect(c.vars['slug']).toBe('oem-example-api');
    expect(weakest(['verified', 'unverified', 'derived'])).toBe('unverified');
    expect(weakest([])).toBe('derived');
  });

  it('answers not_covered for an undeclared platform and for an uncovered repository, each with its note', () => {
    const none = locateRepo({
      repo: repo('fx-example-api'),
      env: 'selfhosted',
      platform: 'openobserve',
      environments,
      binding: binding('openobserve'),
    });
    expect(none).toMatchObject({
      status: 'not_covered',
      command: null,
      confidence: 'not_covered',
      notes: ['no central log store'],
    });
    const off = locateRepo({
      repo: repo('fx-example-legacy'),
      env: 'dev',
      platform: 'sentry',
      environments,
      binding: binding('sentry'),
    });
    expect(off).toMatchObject({ status: 'not_covered', notes: ['decommissioned'] });
  });

  it('answers not_covered when an entry declares it, rather than deriving a coordinate that does not exist', () => {
    const overridden = locateRepo({
      repo: {
        ...repo('fx-example-api'),
        obs: { overrides: { sentry: { dev: { confidence: 'not_covered', note: 'no project' } } } },
      },
      env: 'dev',
      platform: 'sentry',
      environments,
      binding: binding('sentry'),
    });
    expect(overridden).toMatchObject({
      status: 'not_covered',
      command: null,
      notes: ['no project'],
    });

    const dev = environments.envs['dev']!;
    const onEnv = locateRepo({
      repo: repo('fx-example-api'),
      env: 'dev',
      platform: 'sentry',
      environments: {
        ...environments,
        envs: {
          ...environments.envs,
          dev: { ...dev, platforms: { ...dev.platforms, sentry: { confidence: 'not_covered' } } },
        },
      },
      binding: binding('sentry'),
    });
    expect(onEnv).toMatchObject({ status: 'not_covered', command: null });
  });

  it('falls back to the provider default when the manifest has no template, and keeps unknown placeholders visible', () => {
    const noTemplate = {
      ...environments,
      platforms: { ...environments.platforms, jenkins: { vars: { host: 'jenkins.example.com' } } },
    };
    const c = locateRepo({
      repo: repo('fx-example-api'),
      env: 'dev',
      platform: 'jenkins',
      environments: noTemplate,
      binding: binding('jenkins'),
      locate: (vars) => ({
        label: 'job {path}',
        command: ['jenkins-cli', 'build', 'list', vars['path'] ?? '{path}'],
        url: 'https://{host}/job/{missing}',
      }),
    });
    expect(c.command).toBe('jenkins-cli build list services/fx-example-api/feature%2Fdev');
    expect(c.label).toBe('job services/fx-example-api/feature%2Fdev');
    expect(c.url).toBe('https://jenkins.example.com/job/{missing}');
    const bare = locateRepo({
      repo: repo('fx-example-api'),
      env: 'dev',
      platform: 'jenkins',
      environments: noTemplate,
      binding: binding('jenkins'),
    });
    expect(bare.command).toBeNull();
  });

  it('derives the service name from the repository name unless declared', () => {
    expect(serviceOf({ name: 'fx-example-auth' })).toBe('example-auth');
    expect(serviceOf({ name: 'agent-app', obs: {} })).toBe('agent-app');
    expect(serviceOf({ name: 'fx-example-api', obs: { svc: 'code-main' } })).toBe('code-main');
  });
});
