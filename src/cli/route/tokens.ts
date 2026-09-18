// How routing reads one argv entry as a flag. The parser definitions own arity
// and accepted values, so routing keeps no second table of them, and every
// scan over argv asks this module rather than re-deriving the rules.

import { globalFlags } from '../flags.js';

// Flags oclif itself answers when nothing else is on the line.
export const PRE_OK = new Set(['-h', '--help', '-v', '--version']);

const DEFINITIONS = new Map(Object.entries(globalFlags).map(([name, flag]) => [`--${name}`, flag]));
export const GLOBAL_FLAGS = new Set(DEFINITIONS.keys());
export const VALUE_FLAGS = new Set(
  [...DEFINITIONS].filter(([, flag]) => flag.type === 'option').map(([name]) => name),
);

export interface FlagToken {
  // The argv entry as written, inline value included.
  readonly token: string;
  readonly name: string;
  readonly inline: string | undefined;
  readonly takesValue: boolean;
  readonly global: boolean;
  // What the flag would take: its inline value, else the next entry.
  readonly value: string | undefined;
  // A value is usable when it is present, not empty and not another flag.
  readonly usable: boolean;
  readonly accepted: boolean;
  // The last argv index this flag consumes, its separate value included.
  readonly last: number;
}

export function readFlag(argv: readonly string[], index: number): FlagToken | undefined {
  const token = argv[index] ?? '';
  if (!token.startsWith('-')) return undefined;
  const eq = token.indexOf('=');
  const name = eq === -1 ? token : token.slice(0, eq);
  const inline = eq === -1 ? undefined : token.slice(eq + 1);
  const takesValue = VALUE_FLAGS.has(name);
  const value = inline ?? (takesValue ? argv[index + 1] : undefined);
  const usable = value !== undefined && value !== '' && !value.startsWith('-');
  return {
    token,
    name,
    inline,
    takesValue,
    global: GLOBAL_FLAGS.has(name),
    value,
    usable,
    accepted: usable && acceptsValue(name, value),
    last: takesValue && inline === undefined && usable ? index + 1 : index,
  };
}

function acceptsValue(name: string, value: string): boolean {
  const flag = DEFINITIONS.get(name);
  return (
    flag?.type !== 'option' ||
    flag.options === undefined ||
    (flag.options as readonly string[]).includes(value)
  );
}
