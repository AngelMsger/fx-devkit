// Read selectors from the same sensitive source as member queries, without persisting results.
import {
  memberSelectors,
  type MemberSelector,
  type SelectorKind,
} from '../../domain/members/selectors.js';
import type { WorkspaceDeps } from '../workspace/deps.js';

import { membersOf } from './source.js';

export class MemberSelectors {
  constructor(private readonly deps: WorkspaceDeps) {}

  execute(input: { readonly kind?: SelectorKind | undefined } = {}): MemberSelector[] {
    return memberSelectors(membersOf(this.deps.ctx)).filter(
      (row) => !input.kind || row.kind === input.kind,
    );
  }
}
