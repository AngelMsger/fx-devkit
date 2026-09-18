// Captures selected working bytes against an explicit base. Unsupported paths
// cannot redirect reads outside the source; text must decode without replacement.

import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';

import { selectContributionFiles } from '../../domain/contribution/selection.js';
import type { ContributionFile } from '../../domain/contribution/snapshot.js';
import { DevkitError } from '../../domain/errors.js';
import type { CaptureContribution, ContributionSnapshot } from '../../ports/contribution-git.js';
import type { Process } from '../../ports/process.js';

import { runContributionGit } from './contribution-command.js';
import {
  computeContributionTree,
  parseContributionTree,
  type ContributionTreeEntry,
} from './contribution-tree.js';

export async function captureContribution(
  process: Process,
  input: CaptureContribution,
): Promise<ContributionSnapshot> {
  const dir = await fs.realpath(input.dir);
  const git = (args: readonly string[]): Promise<string> =>
    runContributionGit({ process, dir, args });
  const root = (await git(['rev-parse', '--show-toplevel'])).trim();
  if ((await fs.realpath(root)) !== dir)
    throw new DevkitError('usage', 'SOURCE_ROOT_REQUIRED', 'Use the registered source root', {
      nextSteps: [
        'fx workspace show',
        `Register the source at the repository root ${root}, or move the checkout out of the enclosing repository.`,
      ],
    });
  const base = (
    await git(['rev-parse', '--verify', '--end-of-options', `${input.base}^{commit}`])
  ).trim();
  const head = (await git(['rev-parse', '--verify', 'HEAD'])).trim();
  const changed = parseChanges(
    await git(['diff', '--no-ext-diff', '--no-textconv', '--name-status', '-z', '-M', base, '--']),
  );
  const untracked = (await git(['ls-files', '--others', '--exclude-standard', '-z']))
    .split('\0')
    .filter(Boolean);
  for (const file of untracked)
    changed.push({ path: file, mode: '100644', kind: 'file', content: '' });
  const selected = selectContributionFiles({ paths: input.paths, changes: changed });
  const modes = await indexModes(git);
  const files: ContributionFile[] = [];
  for (const file of selected) files.push(await captureFile(dir, file, modes));
  const entries = parseContributionTree(await git(['ls-tree', '-r', '-z', base]));
  const baseFiles = await readBase(git, entries);
  const tree = computeContributionTree({ entries, files, objectLength: base.length });
  return {
    dir,
    base,
    head,
    paths: [...input.paths],
    files,
    baseFiles,
    fingerprint: fingerprint({ base, head, files }),
    tree,
  };
}

function parseChanges(text: string): ContributionFile[] {
  const fields = text.split('\0');
  const files: ContributionFile[] = [];
  for (let i = 0; i < fields.length - 1;) {
    const status = fields[i++]!;
    const first = fields[i++]!;
    if (status.startsWith('R')) {
      const second = fields[i++]!;
      files.push({
        path: first,
        kind: 'deleted',
        mode: '100644',
        content: null,
        renamePeer: second,
      });
      files.push({ path: second, kind: 'file', mode: '100644', content: '', renamePeer: first });
    } else
      files.push({
        path: first,
        kind: status === 'D' ? 'deleted' : 'file',
        mode: '100644',
        content: status === 'D' ? null : '',
      });
  }
  return files;
}

async function captureFile(
  root: string,
  file: ContributionFile,
  modes: ReadonlyMap<string, string>,
): Promise<ContributionFile> {
  if (file.kind === 'deleted') return file;
  const target = path.join(root, file.path);
  await assertAncestors(root, file.path);
  const info = await fs.lstat(target);
  const actual = await fs.realpath(target);
  const relative = path.relative(root, actual);
  if (!info.isFile() || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative))
    throw new DevkitError(
      'usage',
      'SOURCE_ENTRY_UNSUPPORTED',
      'Selected entries must be regular source files',
      {
        nextSteps: [
          `ls -l ${target}`,
          `Remove ${file.path} from the selection; only regular files can be contributed.`,
        ],
      },
    );
  const bytes = await fs.readFile(target);
  let content: string;
  try {
    content = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
  } catch {
    throw new DevkitError(
      'usage',
      'SOURCE_ENTRY_UNSUPPORTED',
      'Selected files must be UTF-8 text',
      { nextSteps: [`Re-encode ${file.path} as UTF-8, or remove it from the selection.`] },
    );
  }
  if (content.includes('\0'))
    throw new DevkitError(
      'usage',
      'SOURCE_ENTRY_UNSUPPORTED',
      'Binary contributions require manual review',
      {
        nextSteps: [
          `Remove ${file.path} from the selection and deliver binary content through the code host.`,
        ],
      },
    );
  const executable =
    process.platform === 'win32' ? modes.get(file.path) === '100755' : (info.mode & 0o111) !== 0;
  return { ...file, mode: executable ? '100755' : '100644', content };
}

async function indexModes(
  git: (args: readonly string[]) => Promise<string>,
): Promise<ReadonlyMap<string, string>> {
  const entries = parseContributionTree(await git(['ls-tree', '-r', '-z', 'HEAD']));
  const modes = new Map(entries.map((entry) => [entry.path, entry.mode]));
  for (const entry of (await git(['ls-files', '--stage', '-z'])).split('\0')) {
    const match = /^(\d+) [a-f0-9]+ 0\t([\s\S]+)$/.exec(entry);
    if (match) modes.set(match[2]!, match[1]!);
  }
  return modes;
}

async function readBase(
  git: (args: readonly string[]) => Promise<string>,
  entries: readonly ContributionTreeEntry[],
): Promise<Readonly<Record<string, string>>> {
  const files: Record<string, string> = Object.create(null);
  for (const { path: file, mode, oid } of entries) {
    if (mode !== '100644' && mode !== '100755') continue;
    const text = await git(['cat-file', 'blob', oid]);
    // Opaque blobs remain present so a malformed optional document cannot disappear.
    files[file] = text.includes('\0') || text.includes('\ufffd') ? '\0' : text;
  }
  return files;
}

function fingerprint(input: {
  base: string;
  head: string;
  files: readonly ContributionFile[];
}): string {
  return createHash('sha256').update(JSON.stringify(input)).digest('hex');
}

async function assertAncestors(root: string, file: string): Promise<void> {
  let current = root;
  for (const segment of file.split('/').slice(0, -1)) {
    current = path.join(current, segment);
    if (!(await fs.lstat(current)).isDirectory())
      throw new DevkitError(
        'usage',
        'SOURCE_ENTRY_UNSUPPORTED',
        'Selected paths cannot traverse symbolic links',
        {
          nextSteps: [
            `Select ${file} through its real directory instead of the symbolic link at ${current}.`,
          ],
        },
      );
  }
}

export async function readContributionBase(input: {
  readonly process: Process;
  readonly dir: string;
  readonly ref: string;
}): Promise<Readonly<Record<string, string>>> {
  const git = (args: readonly string[]): Promise<string> => runContributionGit({ ...input, args });
  const entries = parseContributionTree(await git(['ls-tree', '-r', '-z', input.ref]));
  return readBase(git, entries);
}
