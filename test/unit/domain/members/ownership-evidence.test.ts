// A repository may span several business scopes. Responsibility evidence must
// preserve their provenance and unknowns without assigning an individual owner.

import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { loadMembers } from '../../../../src/domain/manifest/loader.js';
import type { Members } from '../../../../src/domain/manifest/types.js';
import { ownershipEvidence } from '../../../../src/domain/members/ownership-evidence.js';

const doc = loadMembers(
  readFileSync('test/fixtures/manifest/member-collaboration/members.yaml', 'utf8'),
  { cliVersion: '0.17.0', strict: true },
).doc;
const today = '2025-02-05';
const query = (members: Members | undefined, repo = 'folio', asOf?: string) =>
  ownershipEvidence({ members, repo, asOf, today });

describe('repository responsibility evidence', () => {
  it('keeps each business scope and relationship provenance without choosing among candidates', () => {
    const members: Members = {
      ...doc,
      people: doc.people.map((person) =>
        person.id === 'person-a'
          ? { ...person, status: 'initialized', mentor: 'person-b', leader: 'person-c' }
          : person,
      ),
      assignments: [
        ...doc.assignments!,
        {
          person: 'person-b',
          area: 'domain-docs',
          scenario: 'proof',
          team: 'team-alpha',
          status: 'unverified',
          source: 'note/alpha',
        },
        {
          person: 'person-b',
          area: 'domain-docs',
          scenario: 'proof',
          team: 'team-beta',
          status: 'unverified',
          source: 'note/beta',
        },
      ],
    };
    const result = query(members);
    expect(result).toMatchObject({
      as_of: today,
      basis: 'current_members_document',
      historical_snapshot: false,
      coverage: 'checked',
      has_more: false,
    });
    expect(result.items).toMatchObject([
      {
        context: { area: 'domain-docs', scenario: 'proof', as_of: today },
        status: 'relations_recorded',
        responsible_teams: [{ team: 'team-alpha' }, { team: 'team-beta' }],
        people: [
          {
            id: 'person-a',
            status: 'initialized',
            mentor: 'person-b',
            leader: 'person-c',
            classification: 'confirmed',
            memberships: [{ team: 'team-beta' }],
            assignments: [{ team: 'team-alpha', source: 'card/iris', verified_at: '2025-02-04' }],
          },
          {
            id: 'person-b',
            classification: 'multiple_candidates',
            assignments: [{ source: 'note/alpha' }, { source: 'note/beta' }],
          },
        ],
      },
      {
        context: { area: 'domain-forms', scenario: 'fold' },
        people: [{ id: 'person-a', assignments: [{ source: 'card/lily' }] }],
      },
    ]);
    expect(result.items[0]?.people[0]?.assignments).toHaveLength(1);
    expect(result).not.toHaveProperty('selected_owner');
  });

  it('uses the requested effective date and retains collective and team-only scope facts', () => {
    const members: Members = {
      ...doc,
      assignments: doc.assignments!.map((assignment) => ({
        ...assignment,
        valid_from: '2025-02-01',
        valid_until: '2025-03-01',
      })),
    };
    expect(query(members, 'folio', '2025-02-01').items[0]).toMatchObject({
      people: [{ id: 'person-a', assignments: [{ valid_from: '2025-02-01' }] }],
      collective: { assignments: [{ person: 'all', valid_until: '2025-03-01' }] },
    });
    const expired = query(members, 'folio', '2025-03-01');
    expect(expired.items).toMatchObject([
      {
        status: 'relations_recorded',
        people: [],
        collective: { roles: [{ person: 'all', role: 'reader' }], assignments: [] },
      },
      { status: 'relations_recorded', people: [], responsible_teams: [{ team: 'team-beta' }] },
    ]);
    expect(expired.items.every((item) => item.people.length === 0)).toBe(true);
  });

  it('keeps legacy area leads and scenario roles without pulling unrelated people into a scope', () => {
    const members: Members = {
      schema_version: 1,
      sensitive: true,
      people: [{ id: 'lead' }, { id: 'writer' }, { id: 'unrelated' }],
      areas: [
        {
          group: 'Workshop',
          lead: 'lead',
          scenarios: [
            { name: 'Writing', repos: ['folio'], roles: { writer: ['writer'], reader: ['all'] } },
            { name: 'Printing', repos: ['press'], dev_lead: 'unrelated' },
          ],
        },
        {
          group: 'Workshop',
          lead: 'unrelated',
          scenarios: [{ name: 'Writing', repos: ['press'], dev_lead: 'unrelated' }],
        },
      ],
    };
    expect(query(members).items).toMatchObject([
      {
        people: [
          {
            id: 'lead',
            classification: 'not_configured',
            legacy_roles: [{ role: 'lead', scenario: null }],
          },
          { id: 'writer', legacy_roles: [{ role: 'writer', scenario: 'Writing' }] },
        ],
        collective: { roles: [{ person: 'all', role: 'reader' }] },
      },
    ]);
    expect(query(members).items[0]?.people.map((person) => person.id)).toEqual(['lead', 'writer']);
  });

  it('distinguishes an absent document, uncovered repository and mapped scope with no relationships', () => {
    expect(query(undefined)).toMatchObject({ coverage: 'not_configured', items: [] });
    expect(query(doc, 'unmapped')).toMatchObject({ coverage: 'not_covered', items: [] });
    const empty: Members = {
      schema_version: 2,
      sensitive: true,
      people: [],
      areas: [
        {
          id: 'empty',
          group: 'Empty',
          scenarios: [{ id: 'blank', name: 'Blank', repos: ['folio'] }],
        },
      ],
    };
    expect(query(empty)).toMatchObject({
      coverage: 'checked',
      items: [
        {
          status: 'no_relationships',
          people: [],
          responsible_teams: [],
          collective: { roles: [], assignments: [] },
        },
      ],
    });
    expect(() => query(undefined, 'folio', '2025-02-30')).toThrow(
      expect.objectContaining({ code: 'INVALID_AS_OF' }),
    );
  });
});
