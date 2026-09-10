// Who is responsible for what, read off the ownership matrix. "all" is a
// role's way of saying the whole team and is kept as written, never
// expanded into names.

import type { Members } from '../manifest/types.js';

// The id is the members document's key; name and email are null when the
// id names nobody there ("all" included).
export interface PersonRef {
  readonly id: string;
  readonly name: string | null;
  readonly email: string | null;
}

export interface Ownership {
  readonly area: string;
  readonly lead: PersonRef | null;
  readonly scenario: string;
  readonly devLead: PersonRef | null;
  readonly roles: Readonly<Record<string, readonly PersonRef[]>>;
}

export function ownersOf(members: Members, repo: string): Ownership[] {
  const ref = (id: string): PersonRef => {
    const person = members.people.find((p) => p.id === id);
    return { id, name: person?.display ?? null, email: person?.email ?? null };
  };
  const owners: Ownership[] = [];
  for (const area of members.areas ?? []) {
    for (const scenario of area.scenarios ?? []) {
      if (!(scenario.repos ?? []).includes(repo)) continue;
      owners.push({
        area: area.group,
        lead: area.lead === undefined ? null : ref(area.lead),
        scenario: scenario.name,
        devLead: scenario.dev_lead === undefined ? null : ref(scenario.dev_lead),
        roles: Object.fromEntries(
          Object.entries(scenario.roles ?? {}).map(([role, ids]) => [role, ids.map(ref)]),
        ),
      });
    }
  }
  return owners;
}

export function areasOf(members: Members, personId: string): string[] {
  return (members.areas ?? [])
    .filter((area) => peopleOfArea(members, area.group).includes(personId))
    .map((area) => area.group);
}

export function peopleOfArea(members: Members, group: string): string[] {
  const area = (members.areas ?? []).find((a) => a.group === group);
  if (area === undefined) return [];
  const ids = new Set<string>();
  if (area.lead !== undefined) ids.add(area.lead);
  for (const scenario of area.scenarios ?? []) {
    if (scenario.dev_lead !== undefined) ids.add(scenario.dev_lead);
    for (const people of Object.values(scenario.roles ?? {}))
      for (const id of people) if (id !== 'all') ids.add(id);
  }
  return [...ids];
}
