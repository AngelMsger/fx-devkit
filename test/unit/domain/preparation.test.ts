import { describe, expect, it } from 'vitest';

import { hasPreparationIssue } from '../../../src/domain/preparation.js';

describe('preparation completeness', () => {
  it.each(['skip_dirty', 'skip_diverged', 'skip_not_git', 'skip_remote_mismatch', 'unreadable'])(
    'keeps protected/unavailable work incomplete: %s',
    (action) => {
      expect(hasPreparationIssue([{ action, result: 'skipped' }])).toBe(true);
    },
  );
  it('ignores descriptive metadata, unselected repositories and inapplicable findings', () => {
    expect(
      hasPreparationIssue([
        { action: 'skip_unpicked', result: 'skipped' },
        { coverage: 'not_applicable', status: 'unknown' },
        {
          name: 'not_implemented',
          description: 'not_implemented',
          action: 'fast_forward',
          result: 'done',
          outcome: 'up_to_date',
        },
      ]),
    ).toBe(false);
    expect(
      hasPreparationIssue({
        stage_details: {
          services: {
            items: [{ status: 'unchanged', detail: 'not_implemented' }],
          },
          skills: {
            tools: [{ status: 'done', vector: ['sample-cli', 'not_implemented'] }],
          },
        },
      }),
    ).toBe(false);
  });
  it('considers every requested stage, even after all repositories succeed', () => {
    expect(
      hasPreparationIssue({
        summary: { done: 1, failed: 0 },
        stages: { skills: { tools_blocked: 1 } },
      }),
    ).toBe(true);
    expect(hasPreparationIssue({ stages: { docs: { missing_regions: 1 } } })).toBe(true);
    expect(hasPreparationIssue({ stages: { hooks: 'not_implemented' } })).toBe(true);
    expect(hasPreparationIssue({ name: 'not_implemented', status: 'blocked' })).toBe(true);
    expect(hasPreparationIssue({ description: 'not_implemented', result: 'failed' })).toBe(true);
    expect(
      hasPreparationIssue({ stages: { docs: { updated: 1 }, tools: { disabled: 3, unused: 2 } } }),
    ).toBe(false);
    expect(
      hasPreparationIssue({
        stage_details: { hooks: { items: [{ status: 'current', activation: 'unverified' }] } },
      }),
    ).toBe(true);
  });
});
