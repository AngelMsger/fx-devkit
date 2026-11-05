// Who is meant by a name. Identifiers are matched exactly and in a fixed
// order of trust — an email address is unambiguous, a display name is not —
// and only when nothing matches exactly does spelling distance get a say.

import { nearest, nearestMatches } from '../fuzzy.js';
import type { Members, Person } from '../manifest/types.js';

export type MatchedBy = 'email' | 'id' | 'account' | 'display' | 'git_name' | 'fuzzy';

export interface Match {
  readonly person: Person;
  readonly matchedBy: MatchedBy;
  // The system whose account matched, or the git name that did.
  readonly via?: string;
}

const ORDER: readonly MatchedBy[] = ['email', 'id', 'account', 'display', 'git_name'];

export function findPeople(members: Members, query: string, system?: string): Match[] {
  const q = query.trim().toLowerCase();
  const matches: Match[] = [];
  for (const person of members.people) {
    if (system !== undefined) {
      const account = person.accounts?.[system];
      if (account !== undefined && accountMatches(account, query.trim(), false))
        matches.push({ person, matchedBy: 'account', via: system });
      continue;
    }
    const hit = exactMatch(person, query.trim(), members.schema_version === 1);
    if (hit !== undefined) matches.push(hit);
  }
  if (matches.length > 0)
    return matches.sort((a, b) => ORDER.indexOf(a.matchedBy) - ORDER.indexOf(b.matchedBy));
  if (system !== undefined) return [];
  const candidates = members.people.flatMap((p) => [
    p.id,
    ...(p.display === undefined ? [] : [p.display]),
  ]);
  const near = new Set(
    nearestMatches(
      q,
      candidates.map((c) => c.toLowerCase()),
      2,
    ),
  );
  return members.people.flatMap((person) => {
    const via = [person.id, person.display].find(
      (name) => name !== undefined && near.has(name.toLowerCase()),
    );
    return via === undefined
      ? []
      : [{ person, matchedBy: 'fuzzy' as const, via: via.toLowerCase() }];
  });
}

function exactMatch(person: Person, query: string, legacy: boolean): Match | undefined {
  const q = query.toLowerCase();
  if (person.email?.toLowerCase() === q) return { person, matchedBy: 'email' };
  if (person.id.toLowerCase() === q) return { person, matchedBy: 'id' };
  for (const [system, account] of Object.entries(person.accounts ?? {})) {
    if (accountMatches(account, query, legacy))
      return { person, matchedBy: 'account', via: system };
  }
  if (person.display !== undefined && person.display.toLowerCase().includes(q))
    return { person, matchedBy: 'display' };
  const gitName = (person.git_names ?? []).find((n) => n.toLowerCase() === q);
  if (gitName !== undefined) return { person, matchedBy: 'git_name', via: gitName };
  return undefined;
}

function accountMatches(
  account: NonNullable<Person['accounts']>[string],
  query: string,
  legacy: boolean,
): boolean {
  const username = typeof account === 'string' ? account : account.username;
  if (username?.toLowerCase() === query.toLowerCase()) return true;
  if (typeof account === 'string') return false;
  return legacy ? account.id?.toLowerCase() === query.toLowerCase() : account.id === query;
}

// A commit author is attributed only on an exact git name or display
// name; there is no fuzzy step, and two people sharing a name means nobody.
export function findByGitName(members: Members, name: string): Person | undefined {
  const q = name.trim().toLowerCase();
  const hits = members.people.filter(
    (p) => (p.git_names ?? []).some((n) => n.toLowerCase() === q) || p.display?.toLowerCase() === q,
  );
  return hits.length === 1 ? hits[0] : undefined;
}

export function suggestPerson(members: Members, query: string): string | undefined {
  return nearest(
    query,
    members.people.flatMap((p) => [p.id, ...(p.display === undefined ? [] : [p.display])]),
  );
}
