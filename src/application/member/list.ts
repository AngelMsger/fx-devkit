// List people through the same in-memory classification view used by member show.
import { memberView, type MemberFilter, type MemberRow } from '../../domain/members/classify.js';
import type { WorkspaceDeps } from '../workspace/deps.js';

import { membersOf } from './source.js';

export const MEMBER_COLUMNS = ['id', 'display', 'status', 'areas'] as const;

export class MemberList {
  constructor(private readonly deps: WorkspaceDeps) {}

  execute(input: MemberFilter): MemberRow[] {
    const members = membersOf(this.deps.ctx);
    const view = memberView(members, input, new Date().toISOString().slice(0, 10));
    return members.people.flatMap((person) => view.list(person) ?? []);
  }
}
