import { describe, expect, it } from 'vitest';

import { coordinateFingerprint, probeScope } from '../../../../src/domain/obs/observation.js';

describe('recorded probe scope', () => {
  it('keeps repository-derived and repository-overridden probes scoped to one repository', () => {
    expect(
      probeScope({
        template: ['tool', '{path}'],
        vars: { path: 'jobs/{svc}' },
        hasRepoOverride: false,
      }),
    ).toBe('repository');
    expect(
      probeScope({
        template: ['tool', '{path}'],
        vars: { path: '{alias}', alias: '{repo}' },
        hasRepoOverride: false,
      }),
    ).toBe('repository');
    expect(
      probeScope({ template: ['tool', '{path}'], vars: { path: 'shared' }, hasRepoOverride: true }),
    ).toBe('repository');
  });
  it('allows an environment-wide result only for repository-independent inputs actually used by the probe', () => {
    expect(
      probeScope({
        template: ['tool', '{namespace}'],
        vars: { namespace: 'shared', unused: '{repo}' },
        hasRepoOverride: false,
      }),
    ).toBe('environment');
  });
  it('binds evidence to stable coordinate values without storing their values in the fingerprint', () => {
    const first = coordinateFingerprint({
      provider: 'tool',
      vars: { path: 'one', context: 'dev' },
    });
    expect(coordinateFingerprint({ provider: 'tool', vars: { context: 'dev', path: 'one' } })).toBe(
      first,
    );
    expect(
      coordinateFingerprint({ provider: 'tool', vars: { context: 'dev', path: 'two' } }),
    ).not.toBe(first);
    expect(first).toMatch(/^[0-9a-f]{64}$/);
  });
});
