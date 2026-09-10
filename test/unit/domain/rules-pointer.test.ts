import { describe, expect, it } from 'vitest';

import { projectRulesPointer } from '../../../src/domain/harness/rules.js';

describe('rules pointers', () => {
  it('only creates a fixed route and never replaces a foreign or edited guide', () => {
    const created = projectRulesPointer({ current: null, remove: false });
    expect(created.status).toBe('managed');
    expect(created.text?.split('\n')[0]).toBe('<!-- fx:derived rules -->');
    expect(created.text).toContain('AGENTS.md');
    expect(projectRulesPointer({ current: 'My rules', remove: false })).toEqual({
      status: 'foreign',
      text: 'My rules',
    });
    const changed = created.text + 'Extra user guidance\n';
    expect(projectRulesPointer({ current: changed, remove: true })).toEqual({
      status: 'conflict',
      text: changed,
    });
    expect(projectRulesPointer({ current: created.text, remove: true }).text).toBeNull();
  });
});
