// Resolve commands before spawning so probes and execution share PATH policy.
// Windows environment keys are case-insensitive, including invocation overrides.

import { promises as fs } from 'node:fs';
import path from 'node:path';

export interface ExecutableOptions {
  readonly cwd?: string | undefined;
  readonly env?: NodeJS.ProcessEnv | undefined;
}

export function mergeEnvironment(
  base: NodeJS.ProcessEnv,
  overrides: NodeJS.ProcessEnv = {},
  platform: NodeJS.Platform = process.platform,
): NodeJS.ProcessEnv {
  if (platform !== 'win32') return { ...base, ...overrides };
  const result: NodeJS.ProcessEnv = {};
  for (const [key, value] of [...Object.entries(base), ...Object.entries(overrides)]) {
    const previous = Object.keys(result).find((name) => name.toLowerCase() === key.toLowerCase());
    if (previous) delete result[previous];
    result[key] = value;
  }
  return result;
}

export function executableCandidates(
  binary: string,
  options: ExecutableOptions = {},
  platform: NodeJS.Platform = process.platform,
): string[] {
  const windows = platform === 'win32';
  const paths = windows ? path.win32 : path.posix;
  const env = options.env ?? process.env;
  const lookup = (key: string): string | undefined => {
    const name = Object.keys(env).find((name) =>
      windows ? name.toLowerCase() === key.toLowerCase() : name === key,
    );
    return name === undefined ? undefined : env[name];
  };
  const cwd = options.cwd ?? process.cwd();
  const explicit =
    paths.isAbsolute(binary) || binary.includes('/') || (windows && binary.includes('\\'));
  const dirs = explicit ? [''] : (lookup('PATH') ?? '').split(windows ? ';' : ':').filter(Boolean);
  const extensions = windows
    ? (lookup('PATHEXT') ?? '.COM;.EXE;.BAT;.CMD').split(';').filter(Boolean)
    : [];
  const suffixes = windowsSuffixes(windows, binary, extensions);
  return dirs.flatMap((dir) =>
    suffixes.map((suffix) => paths.resolve(cwd, dir.replace(/^"(.*)"$/, '$1'), binary + suffix)),
  );
}

function windowsSuffixes(windows: boolean, binary: string, extensions: string[]): string[] {
  if (!windows) return [''];
  if (
    extensions.some(
      (extension) => extension.toLowerCase() === path.win32.extname(binary).toLowerCase(),
    )
  )
    return [''];
  return path.win32.extname(binary) ? ['', ...extensions] : [...extensions, ''];
}

export async function findExecutable(
  binary: string,
  options: ExecutableOptions = {},
): Promise<string | undefined> {
  for (const candidate of executableCandidates(binary, options)) {
    try {
      await fs.access(
        candidate,
        process.platform === 'win32' ? fs.constants.F_OK : fs.constants.X_OK,
      );
      if ((await fs.stat(candidate)).isFile()) return candidate;
    } catch {
      // A missing or inaccessible PATH entry does not hide later candidates.
    }
  }
  return undefined;
}
