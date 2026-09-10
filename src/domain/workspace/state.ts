// What a checkout looks like right now, and the parsers that read it off
// git's machine-readable output. `dirty` means tracked changes; untracked
// files are counted separately because they never block a fast-forward.

export interface RepoState {
  readonly branch: string | undefined;
  readonly dirty: boolean;
  readonly untracked: number;
  readonly ahead: number;
  readonly behind: number;
}

export function parsePorcelainStatus(text: string): RepoState {
  let branch: string | undefined;
  let ahead = 0;
  let behind = 0;
  let dirty = false;
  let untracked = 0;
  for (const line of text.split('\n')) {
    if (line.startsWith('# branch.head ')) {
      const head = line.slice('# branch.head '.length).trim();
      branch = head === '(detached)' ? undefined : head;
    } else if (line.startsWith('# branch.ab ')) {
      const match = /\+(\d+) -(\d+)/.exec(line);
      ahead = Number(match?.[1] ?? 0);
      behind = Number(match?.[2] ?? 0);
    } else if (line.startsWith('? ')) {
      untracked += 1;
    } else if (/^[12u] /.test(line)) {
      dirty = true;
    }
  }
  return { branch, dirty, untracked, ahead, behind };
}

export function parseRemotes(text: string): Record<string, string> {
  const remotes: Record<string, string> = {};
  for (const line of text.split('\n')) {
    const match = /^(\S+)\s+(\S+)\s+\(fetch\)$/.exec(line.trim());
    if (match?.[1] !== undefined && match[2] !== undefined) remotes[match[1]] = match[2];
  }
  return remotes;
}

export function parseAheadBehind(text: string): { ahead: number; behind: number } {
  const [ahead = '0', behind = '0'] = text.trim().split(/\s+/);
  return { ahead: Number(ahead), behind: Number(behind) };
}
