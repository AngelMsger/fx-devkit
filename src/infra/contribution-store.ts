// Owned journals contain only validated operation metadata. Writes are locked,
// fsynced and atomically replaced; foreign files and symlinks are never adopted.

import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';

import * as z from 'zod';

import { scanBoundary } from '../domain/boundary/scan.js';
import type { ContributionOperation } from '../domain/contribution/operation.js';
import { busyError, DevkitError } from '../domain/errors.js';
import { assertWorkspaceName } from '../domain/workspace/name.js';
import type { ContributionStore } from '../ports/contribution-store.js';
import type { Lock } from '../ports/lock.js';

const oid = z.string().regex(/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/);
const digest = z.string().regex(/^[0-9a-f]{64}$/);
const relative = z
  .string()
  .min(1)
  .refine(
    (value) =>
      !/[\\\x00-\x1f:]/u.test(value) &&
      value
        .split('/')
        .every(
          (part) => part !== '' && part !== '.' && part !== '..' && part.toLowerCase() !== '.git',
        ),
  );
const record = z
  .strictObject({
    id: z.string().regex(/^[A-Za-z0-9_-]+$/),
    remoteIdentity: digest,
    branch: z.string().regex(/^fx\/contribution\/[A-Za-z0-9_-]+$/),
    baseBranch: z.string().min(1),
    base: oid,
    parent: oid,
    previousHead: oid.nullable(),
    sourceFingerprint: digest,
    paths: z
      .array(
        relative.refine((value) => scanBoundary({ text: value, policy: 'manifest' }).length === 0),
      )
      .min(1),
    files: z
      .array(
        relative.refine((value) => scanBoundary({ text: value, policy: 'manifest' }).length === 0),
      )
      .min(1),
    tree: oid,
    commit: oid.nullable(),
    phase: z.enum(['prepared', 'committed', 'pushed', 'creating_pr', 'open']),
    pullRequestId: z
      .string()
      .regex(/^[1-9][0-9]*$/)
      .nullable(),
    pullRequest: z.string().refine(isSafeUrl).nullable(),
    updatedAt: z.string().refine((value) => Number.isFinite(Date.parse(value))),
  })
  .refine(
    (value) =>
      value.branch === `fx/contribution/${value.id}` &&
      (value.phase === 'prepared') === (value.commit === null) &&
      (value.pullRequestId === null) === (value.pullRequest === null) &&
      (value.phase !== 'open' || value.pullRequestId !== null),
  );
const schema = z.strictObject({
  owner: z.literal('fx:contributions:v1'),
  operations: z.array(record),
});

export class FileContributionStore implements ContributionStore {
  constructor(
    private readonly home: string,
    private readonly lock: Lock,
  ) {}

  async read(workspace: string): Promise<readonly ContributionOperation[]> {
    return this.readFile(this.file(workspace));
  }

  async write(workspace: string, operations: readonly ContributionOperation[]): Promise<void> {
    const file = this.file(workspace);
    let text: string;
    try {
      text = JSON.stringify(schema.parse({ owner: 'fx:contributions:v1', operations }));
    } catch {
      throw invalid();
    }
    await assertSafeParents(this.home, file);
    const lease = await this.lock.acquire({ key: `contributions:${workspace}`, waitMs: 2000 });
    if (!lease) throw busyError('SOURCE_BUSY', 'The contribution journal');
    try {
      await this.readFile(file);
      await fs.mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
      await assertSafeParents(this.home, file);
      await replace(file, text);
    } finally {
      await lease.release();
    }
  }

  private async readFile(file: string): Promise<readonly ContributionOperation[]> {
    await assertSafeParents(this.home, file);
    try {
      const stat = await fs.lstat(file);
      if (!stat.isFile() || stat.nlink !== 1) throw invalid();
      return schema.parse(JSON.parse(await fs.readFile(file, 'utf8'))).operations;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw invalid();
    }
  }

  private file(workspace: string): string {
    assertWorkspaceName(workspace);
    return path.join(this.home, 'workspaces', workspace, 'contributions.json');
  }
}

async function assertSafeParents(home: string, file: string): Promise<void> {
  const stop = path.dirname(path.resolve(home));
  for (
    let directory = path.dirname(path.resolve(file));
    directory !== stop;
    directory = path.dirname(directory)
  ) {
    try {
      if (!(await fs.lstat(directory)).isDirectory()) throw invalid();
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw invalid();
    }
  }
}

async function replace(file: string, text: string): Promise<void> {
  const temporary = `${file}.${randomUUID()}.tmp`;
  try {
    const handle = await fs.open(temporary, 'wx', 0o600);
    try {
      await handle.writeFile(text);
      await handle.sync();
    } finally {
      await handle.close();
    }
    await fs.rename(temporary, file);
    if (process.platform !== 'win32') {
      const directory = await fs.open(path.dirname(file), 'r');
      try {
        await directory.sync();
      } finally {
        await directory.close();
      }
    }
  } finally {
    await fs.rm(temporary, { force: true });
  }
}

function isSafeUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return (
      ['http:', 'https:'].includes(url.protocol) &&
      !url.username &&
      !url.password &&
      !url.search &&
      !url.hash
    );
  } catch {
    return false;
  }
}

function invalid(): DevkitError {
  return new DevkitError(
    'config',
    'SOURCE_JOURNAL_INVALID',
    'Contribution metadata is invalid or foreign.',
    { nextSteps: ['Inspect and repair the workspace contribution journal before retrying.'] },
  );
}
