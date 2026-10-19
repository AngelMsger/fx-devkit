// The contribution journal contains only validated operation metadata, kept
// under the OwnedJournal protocol.

import * as z from 'zod';

import { scanBoundary } from '../domain/boundary/scan.js';
import type { ContributionOperation } from '../domain/contribution/operation.js';
import { busyError, DevkitError } from '../domain/errors.js';
import { isPlainRelativePath } from '../domain/path.js';
import { isPublicHttpUrl } from '../domain/public-url.js';
import type { ContributionStore } from '../ports/contribution-store.js';
import type { Lock } from '../ports/lock.js';

import { OwnedJournal } from './owned-journal.js';
import type { ShapeOf } from './stored-shape.js';
import { contributionJournalPath } from './workspace-home.js';

const oid = z.string().regex(/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/);
const digest = z.string().regex(/^[0-9a-f]{64}$/);
const relative = z.string().refine(isPlainRelativePath);
const consistentRecord = (value: ContributionOperation): boolean =>
  value.branch === `fx/contribution/${value.id}` &&
  (value.phase === 'prepared') === (value.commit === null) &&
  (value.pullRequestId === null) === (value.pullRequest === null) &&
  (value.phase !== 'open' || value.pullRequestId !== null);

const record = (object: typeof z.strictObject) =>
  object({
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
    pullRequest: z.string().refine(isPublicHttpUrl).nullable(),
    updatedAt: z.string().refine((value) => Number.isFinite(Date.parse(value))),
  } satisfies ShapeOf<ContributionOperation>).refine(consistentRecord);
const journal = (object: typeof z.strictObject) =>
  object({
    owner: z.literal('fx:contributions:v1'),
    operations: z.array(record(object)),
  });

const written = journal(z.strictObject);
const read = journal(z.object);

interface StoredJournal {
  readonly owner: 'fx:contributions:v1';
  readonly operations: readonly ContributionOperation[];
}

export class FileContributionStore implements ContributionStore {
  constructor(
    private readonly home: string,
    private readonly lock: Lock,
  ) {}

  async read(workspace: string): Promise<readonly ContributionOperation[]> {
    return (await this.journal(workspace).read())?.operations ?? [];
  }

  async write(workspace: string, operations: readonly ContributionOperation[]): Promise<void> {
    await this.journal(workspace).replace({ owner: 'fx:contributions:v1', operations });
  }

  private journal(workspace: string): OwnedJournal<StoredJournal> {
    return new OwnedJournal({
      home: this.home,
      file: contributionJournalPath(this.home, workspace),
      lock: this.lock,
      lease: { key: `contributions:${workspace}`, waitMs: 2000 },
      encode: (value) => JSON.stringify(written.parse(value)),
      decode: (document) => read.parse(document),
      invalid,
      busy: () => busyError('SOURCE_BUSY', 'The contribution journal'),
    });
  }
}

function invalid(): DevkitError {
  return new DevkitError(
    'config',
    'SOURCE_JOURNAL_INVALID',
    'Contribution metadata is invalid or foreign',
    { nextSteps: ['Inspect and repair the workspace contribution journal before retrying.'] },
  );
}
