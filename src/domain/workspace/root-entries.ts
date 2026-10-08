// A managed root holds checkouts and the resources fx, a service or an agent host
// accounts for. It is a plain directory, so nothing reports a new entry there the
// way Git would: whatever is left over is stray and belongs under the workbench.

export const WORKBENCH_DIR = '.workbench';

export type RootEntryKind = 'checkout' | 'directory' | 'file' | 'link';

export interface RootEntry {
  readonly name: string;
  readonly kind: RootEntryKind;
}

// State an operating system or an editor leaves beside whatever a person opens.
const HOST_STATE = new Set(['.DS_Store', 'Thumbs.db', 'desktop.ini', '.vscode', '.idea']);
const HOST_STATE_SUFFIXES = ['.code-workspace', '.iml'];

const DIGEST_NAMES = 5;
const DIGEST_NAME_LENGTH = 24;

// Paths are relative to the root; only the first segment of each occupies it.
export function accountedNames(paths: readonly string[]): ReadonlySet<string> {
  const names = new Set([WORKBENCH_DIR]);
  for (const relative of paths) {
    const [first] = relative.split(/[\\/]/).filter((part) => part !== '' && part !== '.');
    if (first !== undefined && first !== '..') names.add(first);
  }
  return names;
}

export function isStray(name: string, accounted: ReadonlySet<string>): boolean {
  return (
    !accounted.has(name) &&
    !HOST_STATE.has(name) &&
    !HOST_STATE_SUFFIXES.some((suffix) => name.endsWith(suffix))
  );
}

export function strayDigest(entries: readonly RootEntry[]): string {
  const shown = entries.slice(0, DIGEST_NAMES).map((entry) => bounded(entry.name));
  const rest = entries.length - shown.length;
  return `${entries.length} outside ${WORKBENCH_DIR}: ${shown.join(', ')}${rest > 0 ? `, and ${rest} more` : ''}`;
}

function bounded(name: string): string {
  const line = name.replace(/\s+/g, ' ');
  return line.length > DIGEST_NAME_LENGTH ? `${line.slice(0, DIGEST_NAME_LENGTH - 3)}...` : line;
}
