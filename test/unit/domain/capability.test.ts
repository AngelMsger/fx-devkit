// The capability table is a published contract: it is the manifest's schema, the vocabulary
// `fx can` accepts, and the list a team reads to know what fx can be pointed at.

import { describe, expect, it } from 'vitest';

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
});
