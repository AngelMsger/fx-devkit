import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { loadMembers } from '../../../../src/domain/manifest/loader.js';
import { areasOf, ownersOf, peopleOfArea } from '../../../../src/domain/members/owners.js';
import { findPeople } from '../../../../src/domain/members/resolve.js';

const members = loadMembers(
  readFileSync(path.resolve('test/fixtures/manifest/v1-real-shape/members.yaml'), 'utf8'),
  { cliVersion: '1.0.0' },
).doc;

describe('findPeople', () => {
  it('matches exactly, in order of trust: email before id before account before display before git name', () => {
    expect(findPeople(members, 'alice@example.com').map((m) => m.matchedBy)).toEqual(['email']);
    expect(findPeople(members, 'ou_alice')[0]).toMatchObject({
      matchedBy: 'account',
      via: 'feishu_project',
    });
    expect(findPeople(members, 'BOB')[0]).toMatchObject({ matchedBy: 'id', person: { id: 'bob' } });
    expect(findPeople(members, 'ali')[0]).toMatchObject({ matchedBy: 'display' });
    const twoWays = {
      ...members,
      people: [{ ...members.people[1]!, git_names: ['alice'] }, members.people[0]!],
    };
    expect(findPeople(twoWays, 'alice').map((m) => [m.person.id, m.matchedBy])).toEqual([
      ['alice', 'id'],
      ['bob', 'git_name'],
    ]);
    const plain = {
      ...members,
      people: [
        {
          ...members.people[0]!,
          id: 'a',
          email: undefined,
          display: undefined,
          accounts: undefined,
          git_names: ['Alice'],
        },
      ],
    };
    expect(findPeople(plain, 'Alice')[0]).toMatchObject({ matchedBy: 'git_name', via: 'Alice' });
  });

  it('falls back to spelling distance only when nothing matches exactly, and gives up beyond it', () => {
    expect(findPeople(members, 'alcie')[0]).toMatchObject({
      matchedBy: 'fuzzy',
      person: { id: 'alice' },
    });
    expect(findPeople(members, 'zzzzzz')).toEqual([]);
    expect(findPeople(members, 'not_found'), 'a negative account state is not a handle').toEqual(
      [],
    );
  });
});

const alice = { id: 'alice', name: 'Alice', email: 'alice@example.com' };

describe('ownership', () => {
  it('finds the scenarios a repository belongs to and keeps "all" as written', () => {
    expect(ownersOf(members, 'fx-example-auth')).toEqual([
      {
        area: 'Platform',
        lead: alice,
        scenario: 'Login',
        devLead: alice,
        roles: { backend: [alice], qa: [{ id: 'all', name: null, email: null }] },
      },
    ]);
    expect(ownersOf(members, 'fx-example-api')).toEqual([]);
    expect(peopleOfArea(members, 'Platform')).toEqual(['alice']);
    expect(areasOf(members, 'alice')).toEqual(['Platform']);
    expect(areasOf(members, 'bob')).toEqual([]);
  });
});
