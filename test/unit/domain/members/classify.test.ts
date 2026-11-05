import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { loadMembers } from '../../../../src/domain/manifest/loader.js';
import type { Members } from '../../../../src/domain/manifest/types.js';
import { accountCollisions } from '../../../../src/domain/members/account-collisions.js';
import {
  memberView as queryMembers,
  type MemberFilter,
} from '../../../../src/domain/members/classify.js';
import { ownersOf } from '../../../../src/domain/members/owners.js';
import { findPeople } from '../../../../src/domain/members/resolve.js';

const text = readFileSync('test/fixtures/manifest/member-collaboration/members.yaml', 'utf8');
const options = { cliVersion: '0.16.0', strict: true };
const doc = loadMembers(text, options).doc;
const first = doc.assignments![0]!;
const person = doc.people[0]!;
const scope = { area: 'domain-docs', asOf: '2025-02-01' };
const memberView = (members: Members, input: MemberFilter) =>
  queryMembers(members, input, '2025-02-05');
const describePerson = (members: Members, area?: string) =>
  memberView(members, { area }).describe(person.id, false);

describe('business collaboration', () => {
  it('retains directory, contextual collaboration, declared owners and their provenance', () => {
    expect(describePerson(doc).assignments.map((r) => r.team)).toEqual(['team-alpha', 'team-beta']);
    const docs = describePerson(doc, scope.area);
    expect(docs).toMatchObject({
      memberships: [{ team: 'team-beta', function: 'frontend' }],
      classification: 'confirmed',
      assignments: [{ team: 'team-alpha', source: 'card/iris', verified_at: '2025-02-04' }],
      responsible_teams: [{ team: 'team-alpha' }, { team: 'team-beta' }],
    });
    expect(describePerson(doc, 'domain-forms').assignments.map((r) => r.team)).toEqual([
      'team-beta',
    ]);
    expect(ownersOf(doc, 'folio').map((o) => o.scenario)).toEqual(['Proofreading', 'Folding']);
    expect(docs.collective).toMatchObject({
      roles: [{ person: 'all', role: 'reader' }],
      assignments: [{ person: 'all', team: 'team-beta', function: 'backend' }],
    });
    expect(
      memberView(doc, { ...scope, scenario: 'proof', function: 'backend' }).list(person),
    ).toBeUndefined();
  });

  it('joins filters on one applicable edge, keeps compatible teams, and supports function-only records', () => {
    const members = {
      ...doc,
      assignments: [
        { ...first, function: 'backend' },
        { ...first, team: 'team-beta' },
      ],
    };
    expect(
      memberView(members, { ...scope, team: 'team-alpha', function: 'frontend' }).list(person),
    ).toBeUndefined();
    expect(describePerson(members, scope.area)).toMatchObject({
      classification: 'confirmed',
      assignments: [{ team: 'team-alpha' }, { team: 'team-beta' }],
    });
    expect(
      memberView(doc, { team: 'team-beta', function: 'frontend' })
        .list(person)
        ?.relationships?.map((r) => r.kind),
    ).toEqual(['membership', 'assignment']);
    expect(memberView(doc, { function: 'product' }).list(doc.people[1]!)).toMatchObject({
      id: 'person-b',
      relationships: [{ kind: 'membership' }],
    });
    const extra = {
      ...doc,
      memberships: [...doc.memberships!, { ...doc.memberships![1]!, function: 'interaction' }],
    };
    for (const fn of ['product', 'interaction'])
      expect(memberView(extra, { function: fn }).list(doc.people[1]!)).toBeDefined();
  });

  it('distinguishes partial, candidate and missing evidence without using a directory team as a default', () => {
    const partial = memberView(doc, scope).describe('person-b', false);
    expect(partial).toMatchObject({
      classification: 'not_covered',
      memberships: [{ function: 'product' }],
      assignments: [],
    });
    const roleOnly = { ...doc, assignments: [{ ...first, team: undefined }] };
    expect(describePerson(roleOnly, scope.area)).toMatchObject({
      classification: 'not_covered',
      assignments: [{ function: 'frontend', status: 'confirmed' }],
    });
    expect(memberView(roleOnly, { ...scope, function: 'frontend' }).list(person)).toBeDefined();
    expect(memberView(roleOnly, { ...scope, team: 'team-alpha' }).list(person)).toBeUndefined();
    const candidate = { ...first, status: 'unverified' as const };
    expect(describePerson({ ...doc, assignments: [candidate] }, scope.area).classification).toBe(
      'candidate',
    );
    expect(
      describePerson(
        { ...doc, assignments: [candidate, { ...candidate, team: 'team-beta' }] },
        scope.area,
      ).classification,
    ).toBe('multiple_candidates');
  });

  it('uses inclusive starts and exclusive ends independently of verification', () => {
    const members = {
      ...doc,
      assignments: [
        { ...first, valid_until: '2025-02-02' },
        { ...first, team: 'team-beta', valid_from: '2025-02-02' },
      ],
    };
    for (const [asOf, team] of [
      ['2025-02-01', 'team-alpha'],
      ['2025-02-02', 'team-beta'],
    ] as const)
      expect(
        memberView(members, { ...scope, asOf })
          .describe(person.id, false)
          .assignments.map((r) => r.team),
      ).toEqual([team]);
    expect(() => memberView(doc, { asOf: '2025-02-30' })).toThrow(
      expect.objectContaining({ code: 'INVALID_AS_OF' }),
    );
    for (const key of ['team', 'function', 'area', 'scenario'])
      expect(() => memberView(doc, { ...scope, [key]: 'absent' })).toThrow(
        expect.objectContaining({ code: key.toUpperCase() + '_NOT_FOUND' }),
      );
  });

  it('preserves account namespaces, opaque case, ambiguity and method of identity resolution', () => {
    expect(accountCollisions(doc)).toMatchObject([{ path: 'people[1].accounts' }]);
    expect(findPeople(doc, 'Ax7', 'loom').map((m) => m.person.id)).toEqual([
      'person-a',
      'person-b',
    ]);
    expect(findPeople(doc, 'Ax7', 'post')).toMatchObject([
      { via: 'post', person: { id: 'person-c' } },
    ]);
    expect(findPeople(doc, 'ax7', 'loom')).toEqual([]);
    expect(findPeople(doc, 'Astre')[0]?.matchedBy).toBe('fuzzy');
    expect(
      findPeople({ ...doc, people: [{ id: 'moth' }, { id: 'myth' }] }, 'math').map((m) => [
        m.matchedBy,
        m.via,
      ]),
    ).toEqual([
      ['fuzzy', 'moth'],
      ['fuzzy', 'myth'],
    ]);
  });
});

describe('schema 2 integrity', () => {
  it.each([
    ['min_cli', { ...doc, min_cli: '0.15.0' }],
    ['teams[2].id', { ...doc, teams: [...doc.teams!, doc.teams![0]] }],
    ['areas[0].id', { ...doc, areas: [{ group: 'Missing selector' }] }],
    ['areas[1].id', { ...doc, areas: [doc.areas![0], doc.areas![0]] }],
    [
      'areas[0].scenarios[1].id',
      {
        ...doc,
        areas: [
          {
            ...doc.areas![0],
            scenarios: [doc.areas![0]!.scenarios![0], doc.areas![0]!.scenarios![0]],
          },
        ],
      },
    ],
    ['assignments[0].scenario', { ...doc, assignments: [{ ...first, scenario: 'fold' }] }],
    ['assignments[0].team', { ...doc, assignments: [{ ...first, team: 'absent' }] }],
    ['assignments[0].function', { ...doc, assignments: [{ ...first, function: 'absent' }] }],
    ['assignments[0].person', { ...doc, assignments: [{ ...first, person: 'absent' }] }],
    ['assignments[0].status', { ...doc, assignments: [{ ...first, status: 'maybe' }] }],
    [
      'assignments[0].verified_at',
      { ...doc, assignments: [{ ...first, verified_at: '2025-02-29' }] },
    ],
    [
      'assignments[0].valid_until',
      { ...doc, assignments: [{ ...first, valid_from: '2025-03-01', valid_until: '2025-02-01' }] },
    ],
    ['assignments[1]', { ...doc, assignments: [first, { ...first, source: 'card/other' }] }],
    ['memberships', { ...doc, schema_version: 1 }],
  ])('locates an invalid declaration at %s', (field, bad) => {
    expect(
      loadMembers(JSON.stringify(bad), { ...options, allowInvalid: true }).problems.map(
        (p) => p.path,
      ),
    ).toContain(field);
    expect(() => loadMembers(JSON.stringify(bad), options)).toThrow();
  });
});
