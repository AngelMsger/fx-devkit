import { describe, expect, it } from 'vitest';

import { MemberList } from '../../../../src/application/member/list.js';
import { MemberSelectors } from '../../../../src/application/member/selectors.js';
import { harness, MANIFEST_DIR } from '../../../fakes/workspace.js';

const members = `schema_version: 1
sensitive: true
people: [{id: alice}]
areas:
  - group: Ecosystem
    scenarios: [{name: Help Center, roles: {backend: [alice]}}]
  - group: Data Center
    scenarios: [{name: Help Center}]
`;

describe('member selector discovery', () => {
  it('lists scoped selectors and returns both exact matches instead of a misleading fuzzy area', async () => {
    const h = await harness({ files: { [`${MANIFEST_DIR}/manifest/members.yaml`]: members } });
    expect(new MemberSelectors(h.deps).execute({ kind: 'scenario' })).toEqual([
      { kind: 'scenario', id: 'Help Center', name: 'Help Center', area: 'Ecosystem' },
      { kind: 'scenario', id: 'Help Center', name: 'Help Center', area: 'Data Center' },
    ]);
    expect(() => new MemberList(h.deps).execute({ area: 'Help Center' })).toThrow(
      expect.objectContaining({
        code: 'AREA_NOT_FOUND',
        nextSteps: [
          "fx member list --area Ecosystem --scenario 'Help Center' --workspace fx",
          "fx member list --area 'Data Center' --scenario 'Help Center' --workspace fx",
        ],
      }),
    );
    expect(
      new MemberList(h.deps)
        .execute({ area: 'Ecosystem', scenario: 'Help Center' })
        .map((row) => row.id),
    ).toEqual(['alice']);
    expect(h.reporter.notices).toEqual([]);
    expect(h.localStore.writes).toEqual([]);
  });
});
