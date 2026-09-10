// Candidate tree identities are computed in memory with Git's object encoding.
// Preview and unchanged detection therefore need no temporary index or objects.

import { createHash } from 'node:crypto';

import type { ContributionFile } from '../../domain/contribution/snapshot.js';
import { DevkitError } from '../../domain/errors.js';

export interface ContributionTreeEntry {
  readonly path: string;
  readonly mode: string;
  readonly oid: string;
}

interface CandidateTreeInput {
  readonly entries: readonly ContributionTreeEntry[];
  readonly files: readonly ContributionFile[];
  readonly objectLength: number;
}

interface TreeBlob {
  readonly mode: string;
  readonly oid: string;
}

type Tree = Map<string, TreeBlob | Tree>;

export function computeContributionTree(input: CandidateTreeInput): string {
  const root: Tree = new Map();
  const algorithm = input.objectLength === 64 ? 'sha256' : 'sha1';
  for (const entry of input.entries) put(root, entry.path.split('/'), entry);
  for (const file of input.files.filter((file) => file.content === null))
    put(root, file.path.split('/'), null);
  for (const file of input.files.filter((file) => file.content !== null)) {
    const bytes = Buffer.from(file.content!, 'utf8');
    put(root, file.path.split('/'), { mode: file.mode, oid: hashObject('blob', bytes, algorithm) });
  }
  return hashTree(root, algorithm);
}

function put(root: Tree, segments: readonly string[], value: TreeBlob | null): void {
  const [name, ...rest] = segments;
  if (!name)
    throw new DevkitError(
      'conflict',
      'SOURCE_TREE_INVALID',
      'The source tree has an invalid path.',
    );
  if (rest.length === 0) {
    if (value === null) root.delete(name);
    else {
      if (root.get(name) instanceof Map)
        throw new DevkitError(
          'conflict',
          'SOURCE_TREE_CONFLICT',
          'Select all descendants before replacing a directory.',
        );
      root.set(name, value);
    }
    return;
  }
  const existing = root.get(name);
  if (existing !== undefined && !(existing instanceof Map))
    throw new DevkitError(
      'conflict',
      'SOURCE_TREE_CONFLICT',
      'A candidate file conflicts with a parent file.',
    );
  const child = existing ?? new Map<string, TreeBlob | Tree>();
  put(child, rest, value);
  if (child.size > 0) root.set(name, child);
  else root.delete(name);
}

function hashTree(tree: Tree, algorithm: string): string {
  const entries = [...tree.entries()].sort(([a, av], [b, bv]) =>
    Buffer.compare(
      Buffer.from(a + (av instanceof Map ? '/' : '')),
      Buffer.from(b + (bv instanceof Map ? '/' : '')),
    ),
  );
  const parts: Buffer[] = [];
  for (const [name, value] of entries) {
    const mode = value instanceof Map ? '40000' : value.mode;
    const oid = value instanceof Map ? hashTree(value, algorithm) : value.oid;
    parts.push(Buffer.from(`${mode} ${name}\0`), Buffer.from(oid, 'hex'));
  }
  return hashObject('tree', Buffer.concat(parts), algorithm);
}

function hashObject(kind: string, bytes: Buffer, algorithm: string): string {
  return createHash(algorithm).update(`${kind} ${bytes.length}\0`).update(bytes).digest('hex');
}

export function parseContributionTree(text: string): readonly ContributionTreeEntry[] {
  return text
    .split('\0')
    .filter(Boolean)
    .map((entry) => {
      const tab = entry.indexOf('\t');
      const [mode, , oid] = entry.slice(0, tab).split(' ');
      if (tab < 0 || !mode || !oid)
        throw new DevkitError(
          'parse',
          'SOURCE_TREE_INVALID',
          'Git returned an invalid tree entry.',
        );
      return { path: entry.slice(tab + 1), mode, oid };
    });
}
