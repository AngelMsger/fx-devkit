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
    expect(rows).toEqual([
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
        matched_by: 'email',
        via: null,
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
    expect(await new RepoShow(h.deps).execute({ name: 'fx-example-data' })).toMatchObject({
      name: 'fx-example-data',
      owners: [{ area: 'Platform', scenario: 'Login', devLead: { id: 'alice' } }],
      contact: '#data',
    });
    expect(
      await new RepoShow(h.deps).execute({ name: 'fx-example-api' }),
      'a repository no scenario names has no owners',
    ).toMatchObject({ owners: [], contact: '#platform' });
    const none = await stage(null);
    expect(
      (await new RepoShow(none.deps).execute({ name: 'fx-example-api' })).owners,
      'no members document is not the same as nobody',
    ).toBeNull();
  });

  it('says so when there is no members document', async () => {
    const h = await stage(null);
    expect(() => new MemberShow(h.deps).execute('alice')).toThrow(
      expect.objectContaining({ code: 'MEMBERS_MISSING' }),
    );
  });
});
