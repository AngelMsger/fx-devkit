// A command that changes resources tied to a workspace identity declares where it
// writes as its static `writeScope`; the command base holds the matching operation
// lease while the command runs.

type WriteScope = 'workspace' | 'source';

type ParsedFlags = Readonly<Record<string, unknown>>;

// A fixed scope, or the one this invocation's flags ask for: null when they ask for none.
export type WriteScopeDeclaration = WriteScope | ((flags: ParsedFlags) => WriteScope | null);

// A preview has no effect to serialize, so it never waits for the lease.
export function writeScopeOf(
  command: { readonly writeScope?: WriteScopeDeclaration | undefined },
  flags: ParsedFlags,
): WriteScope | null {
  const declared = command.writeScope;
  if (declared === undefined || flags['dry-run']) return null;
  return typeof declared === 'function' ? declared(flags) : declared;
}
