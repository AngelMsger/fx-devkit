// Map parsed CLI flags to settings through the key catalog; get and list must
// report the same effective invocation values as command execution.

import { KEYS, type KeyName } from '../application/config/keys.js';

export interface ConfigFlagInput {
  readonly flags: Readonly<Record<string, unknown>>;
  readonly argv: readonly string[];
}

export function configFlagValues({
  flags,
  argv,
}: ConfigFlagInput): Readonly<Partial<Record<KeyName, string>>> {
  const values: Partial<Record<KeyName, string>> = {};
  const terminator = argv.indexOf('--');
  const tokens = terminator === -1 ? argv : argv.slice(0, terminator);
  for (const key of KEYS) {
    if (
      !key.flag ||
      !tokens.some((token) => token === `--${key.flag}` || token.startsWith(`--${key.flag}=`))
    )
      continue;
    const value = key.flag === undefined ? undefined : flags[key.flag];
    if (typeof value === 'string') values[key.name] = value;
  }
  return values;
}
