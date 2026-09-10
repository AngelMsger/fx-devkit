import { describe, expect, it } from 'vitest';

import { loadEnvironments } from '../../../../src/domain/manifest/loader.js';
import { locateRepo } from '../../../../src/domain/obs/coordinate.js';
import { coordinateFingerprint } from '../../../../src/domain/obs/observation.js';

const repo = {
  name: 'app',
  path: 'app',
  branch: 'main',
  project: 'TEAM',
  tags: [],
  origin: 'shared' as const,
  overridden: [],
};
const fingerprint = coordinateFingerprint({
  provider: 'tool',
  vars: { repo: 'app', svc: 'app', env: 'dev', path: 'jobs/app' },
});
function environment(path = 'jobs/{repo}') {
  return loadEnvironments(
    JSON.stringify({
      schema_version: 2,
      platforms: { ci: { provider: 'tool', capability: 'ci', vars: { path } } },
      envs: {
        dev: {
          platforms: {
            ci: {
              confidence: 'unverified',
              observations: {
                app: { confidence: 'verified', note: '2026-09-09 probe {path}', fingerprint },
              },
            },
          },
        },
      },
    }),
    { cliVersion: '1.0.0', strict: true },
  ).doc;
}
function coordinate(name: string, path?: string) {
  return locateRepo({
    repo: { ...repo, name },
    env: 'dev',
    platform: 'ci',
    environments: environment(path),
    binding: { platform: 'ci', provider: 'tool', capability: 'ci', source: 'explicit', vars: {} },
  });
}

describe('scoped coordinate confidence', () => {
  it('applies a matching observation only to its repository', () => {
    expect(coordinate('app').confidence).toBe('verified');
    expect(coordinate('other').confidence).toBe('unverified');
  });
  it('does not reuse old verification after the coordinate variables change', () => {
    expect(coordinate('app', 'jobs/changed').confidence).toBe('unverified');
  });
});
