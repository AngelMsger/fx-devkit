// Who a name refers to, with the identifier that matched and the system it
// belongs to — the answer to "is this git author one of us". Several people can
// match one query, and all of them come back.

import { DevkitError } from '../../domain/errors.js';
import type { Person } from '../../domain/manifest/types.js';
import { findPeople, suggestPerson, type MatchedBy } from '../../domain/members/resolve.js';
import type { WorkspaceDeps } from '../workspace/deps.js';

import { membersOf } from './source.js';

export interface PersonRow {
  readonly id: string;
  readonly display: string | null;
  readonly email: string | null;
  readonly status: string;
  readonly accounts: Person['accounts'] extends infer A | undefined ? A : never;
  readonly matched_by: MatchedBy;
  readonly via: string | null;
}

export const PERSON_COLUMNS = [
  'id',
  'display',
  'email',
  'status',
  'matched_by',
  'via',
  'accounts',
] as const;

export class MemberShow {
  constructor(private readonly deps: WorkspaceDeps) {}

  execute(query: string): PersonRow[] {
    const members = membersOf(this.deps.ctx);
    const matches = findPeople(members, query);
    if (matches.length === 0) {
      const suggestion = suggestPerson(members, query);
      throw new DevkitError(
        'not_found',
        'PERSON_NOT_FOUND',
        `Nobody in the members document is "${query}"`,
        {
          hint:
            suggestion === undefined
              ? 'fx member list shows everyone.'
              : `Did you mean "${suggestion}"?`,
          nextSteps: ['fx member list'],
        },
      );
    }
    return matches.map(({ person, matchedBy, via }) => ({
      id: person.id,
      display: person.display ?? null,
      email: person.email ?? null,
      status: person.status ?? 'active',
      accounts: person.accounts ?? {},
      matched_by: matchedBy,
      via: via ?? null,
    }));
  }
}
