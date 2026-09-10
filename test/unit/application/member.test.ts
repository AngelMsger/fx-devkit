import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { MemberList } from '../../../src/application/member/list.js';
import { MemberShow } from '../../../src/application/member/show.js';
import { RepoShow } from '../../../src/application/repo/show.js';
import { MANIFEST_DIR, harness } from '../../fakes/workspace.js';

const fixture = (name: string): string =>
  readFileSync(path.resolve('test/fixtures/manifest/v1-real-shape', name), 'utf8');

async function stage(withMembers = true) {
  return harness({
    workspace: fixture('workspace.yaml'),
    files: withMembers
      ? { [`${MANIFEST_DIR}/manifest/members.yaml`]: fixture('members.yaml') }
      : {},
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
    expect(h.cache.entries.size).toBe(0);
    expect(h.reporter.notices.map((n) => n.code)).not.toContain('PERSON');
    expect(() => new MemberShow(h.deps).execute('carol')).toThrow(/nobody/);
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
    expect(() => new MemberList(h.deps).execute({ area: 'Platfrom' })).toThrow(/not an area/);
  });

  it('puts the owners of a repository, and its contact, on repo show', async () => {
    const h = await stage();
    expect(await new RepoShow(h.deps).execute({ name: 'fx-example-api' })).toMatchObject({
      name: 'fx-example-api',
      owners: [],
      contact: '#platform',
    });
    const none = await stage(false);
    expect(
      (await new RepoShow(none.deps).execute({ name: 'fx-example-api' })).owners,
      'no members document is not the same as nobody',
    ).toBeNull();
    expect((await new RepoShow(h.deps).execute({ name: 'fx-example-data' })).contact).toBe('#data');
  });

  it('says so when there is no members document', async () => {
    const h = await stage(false);
    expect(() => new MemberShow(h.deps).execute('alice')).toThrow(/no manifest\/members.yaml/);
  });
});
