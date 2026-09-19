// The capability table is a published contract: it is the manifest's schema, the vocabulary
// `fx can` accepts, and the list a team reads to know what fx can be pointed at.

import { describe, expect, it } from 'vitest';

import { providersFor } from '../../../src/composition/registry.js';
import {
  CAPABILITIES,
  CAPABILITY_INFO,
  capabilitiesInScope,
} from '../../../src/domain/capability.js';

describe('the capability table', () => {
  it('describes every capability it names, once', () => {
    expect(new Set(CAPABILITIES).size).toBe(CAPABILITIES.length);
    for (const capability of CAPABILITIES) {
      const info = CAPABILITY_INFO[capability];
      expect(info.desc, capability).not.toBe('');
      expect(['workspace', 'environment', 'internal']).toContain(info.scope);
    }
  });

  it('scopes each responsibility where its binding lives', () => {
    expect(capabilitiesInScope('workspace')).toEqual([
      'code-host',
      'issue-tracker',
      'knowledge-base',
      'im',
      'calendar',
      'task',
      'worklog',
    ]);
    expect(capabilitiesInScope('environment')).toEqual([
      'error-tracker',
      'log-store',
      'metrics',
      'ci',
      'cluster',
    ]);
  });

  it('registers a provider under the capability it claims', () => {
    for (const capability of CAPABILITIES)
      for (const provider of providersFor(capability))
        expect(provider.capability, provider.id).toBe(capability);
  });

  // A capability fx names but implements for nobody is a promise it can describe and a
  // manifest can bind; without an adapter it is simply unbound, never a crash.
  it('names metrics without pretending to implement it', () => {
    expect(providersFor('metrics')).toEqual([]);
    expect(CAPABILITY_INFO.metrics.desc).toContain('metrics');
  });
});
