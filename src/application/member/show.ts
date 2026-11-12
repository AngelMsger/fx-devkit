// Who a name refers to, with the identifier that matched and the system it
// belongs to — the answer to "is this git author one of us". Several people can
// match one query, and all of them come back.

import { DevkitError } from '../../domain/errors.js';
import { suggestionHint } from '../../domain/fuzzy.js';
import type { Person } from '../../domain/manifest/types.js';
import type { MemberScope, MemberClassification } from '../../domain/members/classify.js';
import { findPeople, suggestPerson, type MatchedBy } from '../../domain/members/resolve.js';
import type { WorkspaceDeps } from '../workspace/deps.js';

import { membersOf } from './source.js';
import { scopedMemberView } from './view.js';

export interface PersonRow extends MemberClassification {
  readonly id: string;
  readonly display: string | null;
  readonly email: string | null;
  readonly status: string;
  readonly accounts: NonNullable<Person['accounts']>;
  readonly mentor: string | null;
  readonly leader: string | null;
  readonly matched_by: MatchedBy;
  readonly via: string | null;
}

export const PERSON_COLUMNS = [
  'id',
  'display',
  'email',
  'status',
  'mentor',
  'leader',
  'matched_by',
  'via',
  'accounts',
  'classification',
  'memberships',
  'assignments',
  'responsible_teams',
] as const;

export class MemberShow {
  constructor(private readonly deps: WorkspaceDeps) {}

  execute(query: string, input: MemberScope & { system?: string | undefined } = {}): PersonRow[] {
    const members = membersOf(this.deps.ctx);
    const matches = findPeople(members, query, input.system);
    if (matches.length === 0) {
      const suggestion = suggestPerson(members, query);
      throw new DevkitError(
        'not_found',
        'PERSON_NOT_FOUND',
        `Nobody in the members document is "${query}"`,
        {
          hint: suggestionHint(suggestion, 'fx member list shows everyone.'),
          nextSteps: ['fx member list'],
        },
      );
    }
    const view = scopedMemberView(this.deps, members, input);
    return matches.map(({ person, matchedBy, via }) => ({
      id: person.id,
      display: person.display ?? null,
      email: person.email ?? null,
      status: person.status ?? 'active',
      accounts: person.accounts ?? {},
      mentor: person.mentor ?? null,
      leader: person.leader ?? null,
      matched_by: matchedBy,
      via: via ?? null,
      ...view.describe(person.id, matches.length > 1),
    }));
  }
}
