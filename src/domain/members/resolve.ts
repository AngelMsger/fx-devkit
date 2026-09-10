// Who is meant by a name. Identifiers are matched exactly and in a fixed
// order of trust — an email address is unambiguous, a display name is not —
// and only when nothing matches exactly does spelling distance get a say.

import { nearest } from '../fuzzy.js';
import type { Members, Person } from '../manifest/types.js';

export type MatchedBy = 'email' | 'id' | 'account' | 'display' | 'git_name' | 'fuzzy';

export interface Match {
  readonly person: Person;
  readonly matchedBy: MatchedBy;
  // The system whose account matched, or the git name that did.
  readonly via?: string;
}

const ORDER: readonly MatchedBy[] = ['email', 'id', 'account', 'display', 'git_name'];

export function findPeople(members: Members, query: string): Match[] {
  const q = query.trim().toLowerCase();
  const matches: Match[] = [];
  for (const person of members.people) {
    const hit = exactMatch(person, q);
    if (hit !== undefined) matches.push(hit);
  }
  if (matches.length > 0)
    return matches.sort((a, b) => ORDER.indexOf(a.matchedBy) - ORDER.indexOf(b.matchedBy));
  const candidates = members.people.flatMap((p) => [
    p.id,
    ...(p.display === undefined ? [] : [p.display]),
  ]);
  const near = nearest(
    q,
    candidates.map((c) => c.toLowerCase()),
    2,
  );
  if (near === undefined) return [];
  const person = members.people.find(
    (p) => p.id.toLowerCase() === near || p.display?.toLowerCase() === near,
  );
  return person === undefined ? [] : [{ person, matchedBy: 'fuzzy', via: near }];
}

function exactMatch(person: Person, q: string): Match | undefined {
  if (person.email?.toLowerCase() === q) return { person, matchedBy: 'email' };
  if (person.id.toLowerCase() === q) return { person, matchedBy: 'id' };
  for (const [system, account] of Object.entries(person.accounts ?? {})) {
    if (handlesOf(account).some((h) => h.toLowerCase() === q))
      return { person, matchedBy: 'account', via: system };
  }
  if (person.display !== undefined && person.display.toLowerCase().includes(q))
    return { person, matchedBy: 'display' };
  const gitName = (person.git_names ?? []).find((n) => n.toLowerCase() === q);
  if (gitName !== undefined) return { person, matchedBy: 'git_name', via: gitName };
  return undefined;
}

function handlesOf(account: NonNullable<Person['accounts']>[string]): string[] {
  if (typeof account === 'string') return [account];
  return [account.username, account.id].filter((h): h is string => h !== undefined);
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
