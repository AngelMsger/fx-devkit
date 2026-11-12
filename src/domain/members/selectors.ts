// Discover the business vocabulary without exposing people or interpreting similar names.
import type { Members } from '../manifest/types.js';

export type SelectorKind = 'area' | 'scenario' | 'team' | 'function';

export interface MemberSelector {
  readonly kind: SelectorKind;
  readonly id: string;
  readonly name: string;
  readonly area: string | null;
}

export function memberSelectors(doc: Members): MemberSelector[] {
  return [
    ...(doc.areas ?? []).flatMap((area): MemberSelector[] => [
      { kind: 'area', id: area.id ?? area.group, name: area.group, area: null },
      ...(area.scenarios ?? []).map((scenario): MemberSelector => ({
        kind: 'scenario',
        id: scenario.id ?? scenario.name,
        name: scenario.name,
        area: area.id ?? area.group,
      })),
    ]),
    ...(doc.teams ?? []).map((team): MemberSelector => ({
      kind: 'team',
      id: team.id,
      name: team.name,
      area: null,
    })),
    ...(doc.functions ?? []).map((fn): MemberSelector => ({
      kind: 'function',
      id: fn.id,
      name: fn.name,
      area: null,
    })),
  ];
}
