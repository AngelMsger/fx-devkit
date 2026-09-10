// Projects a fixed AGENTS.md pointer; edited or foreign guides remain untouched.

const POINTER =
  '<!-- fx:derived rules -->\nRead AGENTS.md at the workspace root before working.\nUse fx can, fx where and fx doctor for current workspace facts and readiness.\n';

export interface RulesProjectionInput {
  readonly current: string | null;
  readonly remove: boolean;
}
export interface RulesProjectionResult {
  readonly status: 'managed' | 'foreign' | 'conflict';
  readonly text: string | null;
}

export function projectRulesPointer(input: RulesProjectionInput): RulesProjectionResult {
  if (input.current !== null && input.current !== POINTER)
    return {
      status: input.current.startsWith('<!-- fx:derived rules -->') ? 'conflict' : 'foreign',
      text: input.current,
    };
  return { status: 'managed', text: input.remove ? null : POINTER };
}
