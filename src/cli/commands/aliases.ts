// Compatibility names: retired spellings that still execute, kept apart from the
// command classes so the completion command can read them without depending on
// the registry that lists it.

export const COMMAND_ALIASES = {
  'hook:inject': 'hook:enable',
  'hook:remove': 'hook:disable',
  'skill:list': 'agent:skills',
  'tool:installed': 'tool:inventory',
  'manifest:set': 'manifest:repo-set',
  release: 'release:check',
} as const;

export function compatibilityTarget(id: string): string | undefined {
  const mapping: Readonly<Record<string, string>> = COMMAND_ALIASES;
  return mapping[id.replaceAll(' ', ':')];
}
