// The output format an invocation asks for, read before oclif parses anything so that an
// error raised by the parse itself already reads the way the caller asked: explicit
// flag, then environment, then file. While the format is undecided an error leaves as
// the envelope, the one form no caller has to guess at.

import { readSettings } from '../application/config/settings.js';
import { DEFAULT_FORMAT, isFormat, type Format } from '../domain/format.js';
import type { ConfigFile, ConfigStore } from '../ports/stores.js';

export const UNDECIDED_FORMAT: Format = 'json';

export function invocationFormat(
  argv: readonly string[],
  env: NodeJS.ProcessEnv,
  file: ConfigFile,
): Format {
  const asked = readSettings({ env, file, flags: { format: formatFlag(argv) } }).format;
  if (asked === undefined) return DEFAULT_FORMAT;
  return isFormat(asked) ? asked : UNDECIDED_FORMAT;
}

// An unreadable configuration leaves the format undecided.
export async function readInvocationFormat(
  argv: readonly string[],
  env: NodeJS.ProcessEnv,
  config: ConfigStore,
): Promise<Format> {
  try {
    return invocationFormat(argv, env, await config.read());
  } catch {
    return UNDECIDED_FORMAT;
  }
}

function formatFlag(argv: readonly string[]): string | undefined {
  const inline = argv.find((argument) => argument.startsWith('--format='));
  if (inline !== undefined) return inline.slice('--format='.length);
  const at = argv.indexOf('--format');
  return at < 0 ? undefined : argv[at + 1];
}
