// List people through the same in-memory classification view used by member show.
import type { MemberFilter, MemberRow } from '../../domain/members/classify.js';
import type { WorkspaceDeps } from '../workspace/deps.js';

import { membersOf } from './source.js';
import { scopedMemberView } from './view.js';

export const MEMBER_COLUMNS = ['id', 'display', 'status', 'mentor', 'leader', 'areas'] as const;

export class MemberList {
  constructor(private readonly deps: WorkspaceDeps) {}

  execute(input: MemberFilter): MemberRow[] {
    const members = membersOf(this.deps.ctx);
    const view = scopedMemberView(this.deps, members, input);
    return members.people.flatMap((person) => view.list(person) ?? []);
  }
}
