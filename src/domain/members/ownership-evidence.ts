// Repository responsibility facts use the same business scope and validity rules
// as member queries. Filtering the current document is never a historical snapshot
// or a decision about who should own a release; collective records stay collective.

import type { Members, Person } from '../manifest/types.js';

import { memberView, resolveMemberDate, type MemberClassification } from './classify.js';

export interface OwnershipPerson extends Pick<
  MemberClassification,
  'memberships' | 'assignments' | 'legacy_roles' | 'classification'
> {
  readonly id: string;
  readonly display: string | null;
  readonly email: string | null;
  readonly status: string;
  readonly mentor: string | null;
  readonly leader: string | null;
}

export interface OwnershipScope extends Pick<
  MemberClassification,
  'context' | 'responsible_teams' | 'collective'
> {
  readonly area: string;
  readonly scenario: string;
  readonly status: 'relations_recorded' | 'no_relationships';
  readonly people: readonly OwnershipPerson[];
}

export interface OwnershipEvidence {
  readonly as_of: string;
  readonly basis: 'current_members_document';
  readonly historical_snapshot: false;
  readonly coverage: 'checked' | 'not_configured' | 'not_covered';
  readonly items: readonly OwnershipScope[];
  readonly has_more: false;
}

function describePerson(person: Person, facts: MemberClassification): OwnershipPerson {
  return {
    id: person.id,
    display: person.display ?? null,
    email: person.email ?? null,
    status: person.status ?? 'active',
    mentor: person.mentor ?? null,
    leader: person.leader ?? null,
    memberships: facts.memberships,
    assignments: facts.assignments,
    legacy_roles: facts.legacy_roles,
    classification: facts.classification,
  };
}

function scopesOf(members: Members, repo: string, asOf: string): OwnershipScope[] {
  return (members.areas ?? []).flatMap((area) =>
    (area.scenarios ?? [])
      .filter((scenario) => scenario.repos?.includes(repo))
      .map((scenario): OwnershipScope => {
        const view = memberView(
          // Legacy matrices can repeat display names. Keep the exact matrix edge
          // instead of resolving another same-named scope elsewhere in the document.
          { ...members, areas: [{ ...area, scenarios: [scenario] }] },
          { area: area.id ?? area.group, scenario: scenario.id ?? scenario.name, asOf },
          asOf,
        );
        const { context, responsible_teams, collective } = view.describe('all', false);
        const people = members.people
          .filter((person) => view.list(person) !== undefined)
          .map((person) => describePerson(person, view.describe(person.id, false)));
        const hasRelationships =
          people.length > 0 ||
          responsible_teams.length > 0 ||
          collective.roles.length > 0 ||
          collective.assignments.length > 0;
        return {
          area: area.group,
          scenario: scenario.name,
          context,
          status: hasRelationships ? 'relations_recorded' : 'no_relationships',
          responsible_teams,
          people,
          collective,
        };
      }),
  );
}

export function ownershipEvidence(input: {
  readonly members: Members | undefined;
  readonly repo: string;
  readonly asOf?: string | undefined;
  readonly today: string;
}): OwnershipEvidence {
  const asOf = resolveMemberDate(input.asOf, input.today);
  const items = input.members === undefined ? [] : scopesOf(input.members, input.repo, asOf);
  let coverage: OwnershipEvidence['coverage'] = 'checked';
  if (input.members === undefined) coverage = 'not_configured';
  else if (items.length === 0) coverage = 'not_covered';
  return {
    as_of: asOf,
    basis: 'current_members_document',
    historical_snapshot: false,
    coverage,
    items,
    has_more: false,
  };
}
