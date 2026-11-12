import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { MemberList } from '../../../../src/application/member/list.js';
import { MemberShow } from '../../../../src/application/member/show.js';
import { RepoShow } from '../../../../src/application/repo/show.js';
import { MANIFEST_DIR, harness } from '../../../fakes/workspace.js';

const fixture = (name: string): string =>
  readFileSync(path.resolve('test/fixtures/manifest/v1-real-shape', name), 'utf8');

async function stage(members: string | null = fixture('members.yaml')) {
  return harness({
    workspace: fixture('workspace.yaml'),
    files: members === null ? {} : { [`${MANIFEST_DIR}/manifest/members.yaml`]: members },
  });
}

describe('member who / list / owners', () => {
  it('answers with the person and how they were matched, touching nothing but stdout data', async () => {
    const h = await stage();
    const rows = new MemberShow(h.deps).execute('alice@example.com');
    expect(rows).toMatchObject([
      {
        id: 'alice',
        display: 'Alice',
        email: 'alice@example.com',
        status: 'active',
        accounts: {
          bitbucket: { username: 'alice' },
          feishu_project: { id: 'ou_alice' },
          jira: { state: 'not_found' },
        },
        mentor: null,
        leader: null,
        matched_by: 'email',
        via: null,
        classification: 'not_configured',
        memberships: [],
        assignments: [],
        collective: { roles: [{ person: 'all', role: 'qa' }], assignments: [] },
      },
    ]);
    expect(h.reporter.notices).toEqual([]);
    expect(() => new MemberShow(h.deps).execute('carol')).toThrow(
      expect.objectContaining({ code: 'PERSON_NOT_FOUND' }),
    );
  });

  it('lists people with their areas, filtered by area or status', async () => {
    const h = await stage();
    expect(new MemberList(h.deps).execute({}).map((r) => [r.id, r.status, r.areas])).toEqual([
      ['alice', 'active', ['Platform']],
      ['bob', 'resigned', []],
    ]);
    expect(new MemberList(h.deps).execute({ area: 'Platform' }).map((r) => r.id)).toEqual([
      'alice',
    ]);
    expect(new MemberList(h.deps).execute({ status: 'resigned' }).map((r) => r.id)).toEqual([
      'bob',
    ]);
    expect(() => new MemberList(h.deps).execute({ area: 'Platfrom' })).toThrow(
      expect.objectContaining({ code: 'AREA_NOT_FOUND', hint: 'Did you mean "Platform"?' }),
    );
  });

  it('puts the owners of a repository, and its contact, on repo show', async () => {
    const h = await stage(
      fixture('members.yaml').replace('[fx-example-auth]', '[fx-example-data]'),
    );
    expect(
      await new RepoShow(h.deps).execute({ name: 'fx-example-data', asOf: '2025-02-01' }),
    ).toMatchObject({
      name: 'fx-example-data',
      owners: [{ area: 'Platform', scenario: 'Login', devLead: { id: 'alice' } }],
      ownership_evidence: {
        as_of: '2025-02-01',
        historical_snapshot: false,
        coverage: 'checked',
        items: [{ people: [{ id: 'alice', legacy_roles: expect.any(Array) }] }],
      },
      contact: '#data',
    });
    expect(
      await new RepoShow(h.deps).execute({ name: 'fx-example-api' }),
      'a repository no scenario names has no owners',
    ).toMatchObject({
      owners: [],
      ownership_evidence: { coverage: 'not_covered', items: [] },
      contact: '#platform',
    });
    const none = await stage(null);
    expect(
      await new RepoShow(none.deps).execute({ name: 'fx-example-api' }),
      'no members document is not the same as nobody',
    ).toMatchObject({
      owners: null,
      ownership_evidence: { coverage: 'not_configured', items: [] },
    });
    expect(h.reporter.notices).toEqual([]);
    expect(h.fs.writes).toEqual([]);
    expect(h.localStore.writes).toEqual([]);
  });

  it('returns all identity candidates with an explicit ambiguity state', async () => {
    const h = await stage(fixture('../member-collaboration/members.yaml'));
    expect(
      new MemberShow(h.deps).execute('Ax7', { system: 'loom', area: 'domain-docs' }),
    ).toMatchObject([
      { id: 'person-a', matched_by: 'account', via: 'loom', classification: 'identity_ambiguous' },
      { id: 'person-b', matched_by: 'account', via: 'loom', classification: 'identity_ambiguous' },
    ]);
    expect(h.reporter.notices).toEqual([]);
  });

  it('returns personal links independently of business scope and leaves undeclared links unknown', async () => {
    const h = await stage(`schema_version: 1
sensitive: true
people:
  - {id: learner, mentor: guide, leader: owner}
  - {id: guide, leader: owner}
  - {id: owner}
areas:
  - group: Workshop
    scenarios:
      - {name: Drafting, roles: {writer: [learner]}}
`);
    const expected = { id: 'learner', mentor: 'guide', leader: 'owner' };
    expect(new MemberShow(h.deps).execute('learner', { area: 'Workshop' })).toMatchObject([
      expected,
    ]);
    expect(new MemberList(h.deps).execute({ area: 'Workshop' })).toMatchObject([expected]);
    expect(new MemberShow(h.deps).execute('guide')).toMatchObject([
      { mentor: null, leader: 'owner', legacy_roles: [] },
    ]);
    expect(new MemberShow(h.deps).execute('owner')).toMatchObject([{ mentor: null, leader: null }]);
  });

  it('says so when there is no members document', async () => {
    const h = await stage(null);
    expect(() => new MemberShow(h.deps).execute('alice')).toThrow(
      expect.objectContaining({ code: 'MEMBERS_MISSING' }),
    );
  });
});
