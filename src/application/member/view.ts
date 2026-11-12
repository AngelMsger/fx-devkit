// Keep member recovery on the selected workspace; classification only reads member facts.
import { DevkitError } from '../../domain/errors.js';
import type { Members } from '../../domain/manifest/types.js';
import { memberView, type MemberFilter } from '../../domain/members/classify.js';
import {
  memberSelectors,
  type MemberSelector,
  type SelectorKind,
} from '../../domain/members/selectors.js';
import type { WorkspaceDeps } from '../workspace/deps.js';
import { workspaceCommand } from '../workspace/guidance.js';

const SELECTORS: Readonly<Record<string, SelectorKind>> = {
  AREA_NOT_FOUND: 'area',
  SCENARIO_NOT_FOUND: 'scenario',
  TEAM_NOT_FOUND: 'team',
  FUNCTION_NOT_FOUND: 'function',
  SCENARIO_REQUIRES_AREA: 'scenario',
};

export function scopedMemberView(
  deps: WorkspaceDeps,
  members: Members,
  input: MemberFilter,
): ReturnType<typeof memberView> {
  try {
    return memberView(members, input, new Date().toISOString().slice(0, 10));
  } catch (error) {
    if (!(error instanceof DevkitError)) throw error;
    const kind = SELECTORS[error.code];
    if (kind === undefined) throw error;
    const alternatives =
      error.code === 'AREA_NOT_FOUND' && input.area !== undefined
        ? memberSelectors(members).filter(
            (row) => row.kind !== 'area' && (row.id === input.area || row.name === input.area),
          )
        : [];
    throw new DevkitError(error.category, error.code, error.message, {
      cause: error,
      hint:
        alternatives.length === 0
          ? error.hint
          : `This name identifies ${[...new Set(alternatives.map((row) => row.kind))].join(', ')}, not an area. Use an exact selector from member selectors.`,
      nextSteps:
        alternatives.length === 0
          ? [workspaceCommand(deps, 'member', 'selectors', '--kind', kind)]
          : alternatives.map((row) => queryFor(deps, row)),
    });
  }
}

function queryFor(deps: WorkspaceDeps, row: MemberSelector): string {
  return workspaceCommand(
    deps,
    'member',
    'list',
    ...(row.area === null ? [] : ['--area', row.area]),
    `--${row.kind}`,
    row.id,
  );
}
