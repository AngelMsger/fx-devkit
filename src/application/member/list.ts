// People as rows, narrowed by area or status. An area nobody declares is a typo
// worth answering, not an empty list.

import { DevkitError } from '../../domain/errors.js';
import { nearest } from '../../domain/fuzzy.js';
import { areasOf, peopleOfArea } from '../../domain/members/owners.js';
import type { WorkspaceDeps } from '../workspace/deps.js';

import { membersOf } from './source.js';

export interface MemberListInput {
  readonly area?: string | undefined;
  readonly status?: string | undefined;
}

export interface MemberRow {
  readonly id: string;
  readonly display: string | null;
  readonly status: string;
  readonly areas: readonly string[];
}

export class MemberList {
  constructor(private readonly deps: WorkspaceDeps) {}

  execute(input: MemberListInput): MemberRow[] {
    const members = membersOf(this.deps.ctx);
    const groups = (members.areas ?? []).map((a) => a.group);
    if (input.area !== undefined && !groups.includes(input.area)) {
      const suggestion = nearest(input.area, groups);
      throw new DevkitError('not_found', 'AREA_NOT_FOUND', `"${input.area}" is not an area`, {
        hint:
          suggestion === undefined
            ? `Areas: ${groups.join(', ') || '(none)'}.`
            : `Did you mean "${suggestion}"?`,
        nextSteps: ['fx member list'],
      });
    }
    const inArea =
      input.area === undefined ? undefined : new Set(peopleOfArea(members, input.area));
    return members.people
      .filter((p) => inArea === undefined || inArea.has(p.id))
      .filter((p) => input.status === undefined || (p.status ?? 'active') === input.status)
      .map((p) => ({
        id: p.id,
        display: p.display ?? null,
        status: p.status ?? 'active',
        areas: areasOf(members, p.id),
      }));
  }
}
