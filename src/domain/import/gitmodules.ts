// .gitmodules, read for the one thing it records that nothing else does: the branch a
// submodule was meant to track.

export interface SubmoduleEntry {
  readonly url?: string;
  readonly branch?: string;
}

type Field = 'path' | 'url' | 'branch';

export function parseGitmodules(text: string): Record<string, SubmoduleEntry> {
  const byPath: Record<string, SubmoduleEntry> = {};
  let current: Partial<Record<Field, string>> | undefined;
  const flush = (): void => {
    if (current?.path === undefined) return;
    byPath[current.path] = {
      ...(current.url === undefined ? {} : { url: current.url }),
      ...(current.branch === undefined ? {} : { branch: current.branch }),
    };
  };
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (line.startsWith('[submodule')) {
      flush();
      current = {};
      continue;
    }
    const match = /^(path|url|branch)\s*=\s*(.+)$/.exec(line);
    const field = match?.[1] as Field | undefined;
    const value = match?.[2];
    if (current !== undefined && field !== undefined && value !== undefined) {
      current[field] = value.trim();
    }
  }
  flush();
  return byPath;
}
