// Workspace identity changes retire owned resources and retain recovery copies before committing registration.

import { randomUUID } from 'node:crypto';
import path from 'node:path';

import { asDevkitError, busyError, DevkitError, withPartialResult } from '../../domain/errors.js';
import { withLease, workspaceLeaseKey } from '../../domain/lease.js';
import type { ProviderCatalog } from '../../domain/manifest/providers.js';
import { samePath } from '../../domain/path.js';
import { shellLine, type ResolvedShell } from '../../domain/shell.js';
import {
  hasReached,
  matchesRegistry,
  operationJournalPath,
  parseJournal,
  sameEntry,
  sameJournal,
  serializeJournal,
  type OperationAction,
  type OperationJournal,
  type OperationPhase,
} from '../../domain/workspace/operation-journal.js';
import type { FileSystem } from '../../ports/fs.js';
import type { Lock } from '../../ports/lock.js';
import type { ManifestSource } from '../../ports/manifest-source.js';
import type { ConfigStore, WorkspaceEntry } from '../../ports/stores.js';
import { assertWritable, type WritePosture } from '../safety/posture.js';

import { withWorkspaceOperation } from './operation.js';
import { assertDistinctWorkspaceRoot } from './registry.js';
import type { ResourceCleanupRow, WorkspaceResources } from './resources.js';
import { inspectRebindSource, materializeRebindSource } from './source-preview.js';

export interface ManageWorkspaceDeps {
  readonly fs: FileSystem;
  readonly config: ConfigStore;
  readonly lock: Lock;
  readonly resources: WorkspaceResources;
  readonly manifestDirFor: (name: string) => string;
  // The workspace's personal directory, which holds its manifest source and operation journal.
  readonly workspaceHomeFor: (name: string) => string;
  readonly bundledTools: () => string;
  readonly providers: ProviderCatalog;
  readonly cliVersion: string;
  readonly commandShell?: ResolvedShell | undefined;
}
export interface ManageWorkspaceInput {
  readonly name: string;
  readonly action: OperationAction;
  readonly root?: string;
  readonly source?: ManifestSource;
  readonly dryRun: boolean;
  readonly posture: WritePosture;
}
export interface ManageWorkspaceOutput {
  readonly operation: OperationAction;
  readonly name: string;
  readonly before: WorkspaceEntry;
  readonly after: WorkspaceEntry | null;
  readonly checkouts: string;
  readonly personal_scope: string;
  readonly global_tools_and_skills: string;
  readonly resources: readonly ResourceCleanupRow[];
  readonly backup: string | null;
  readonly planned_backup: string | null;
  readonly source_validation: string | null;
  readonly next_steps: readonly string[];
  readonly written: boolean;
}
export class ManageWorkspace {
  constructor(private readonly deps: ManageWorkspaceDeps) {}

  private command(...args: readonly string[]): string {
    return shellLine(['fx', ...args], this.deps.commandShell);
  }

  async execute(input: ManageWorkspaceInput): Promise<ManageWorkspaceOutput> {
    const preview = await this.plan(input);
    if (await this.isNoop(preview)) return this.unchanged(preview);
    if (input.dryRun) return this.run(input);
    assertWritable(input.posture, `workspace ${input.action}`);
    return withWorkspaceOperation(this.deps.lock, input.name, () => this.run(input));
  }

  private async run(input: ManageWorkspaceInput): Promise<ManageWorkspaceOutput> {
    const preview = await this.plan(input);
    if (await this.isNoop(preview)) return this.unchanged(preview);
    const validation =
      input.source && preview.phase === 'planned'
        ? await inspectRebindSource(input.source, { ...this.deps, workspace: input.name })
        : null;
    const resources = await this.cleanup(preview, input, { dryRun: true });
    const result = {
      ...(await this.output(preview, { resources, written: false })),
      source_validation: validation,
    };
    if (input.dryRun) return result;
    assertWritable(input.posture, `workspace ${input.action}`);
    return withLease(
      this.deps.lock,
      { key: workspaceLeaseKey(input.name), waitMs: 2000 },
      () =>
        busyError('LOCK_BUSY', 'The workspace', {
          nextSteps: ['Retry the same workspace command shortly.'],
        }),
      () => this.attempt(preview, input, result),
    );
  }

  private async attempt(
    preview: OperationJournal,
    input: ManageWorkspaceInput,
    result: ManageWorkspaceOutput,
  ): Promise<ManageWorkspaceOutput> {
    const checkpoints = new Checkpoints(this.deps.fs, this.journalPath(input.name));
    try {
      const current = await this.plan(input, preview.id);
      if (!sameJournal(current, preview)) throw changedRegistry();
      return await this.apply(current, input, checkpoints);
    } catch (error) {
      throw withPartialResult(error, {
        ...result,
        ...asDevkitError(error).partialResult,
        backup: await this.retainedBackup(preview),
        written: checkpoints.persisted !== null,
        phase: checkpoints.persisted,
        recovery: this.journalPath(input.name),
        next_steps: ['Retry the same workspace command to resume the retained operation.'],
      });
    }
  }

  private async isNoop(journal: OperationJournal): Promise<boolean> {
    return (
      journal.action === 'relocate' &&
      journal.phase === 'planned' &&
      samePath(await this.deps.fs.realpath(journal.before.root), journal.root)
    );
  }

  private unchanged(journal: OperationJournal): Promise<ManageWorkspaceOutput> {
    return this.output({ ...journal, after: journal.before }, { resources: [], written: false });
  }

  private async plan(
    input: ManageWorkspaceInput,
    id: string = randomUUID(),
  ): Promise<OperationJournal> {
    const pending = await this.readJournal(input.name);
    if (pending) {
      await this.assertPending(input, pending);
      await this.assertCurrentIdentity(pending);
      return pending;
    }
    const config = await this.deps.config.read();
    const before = config.workspaces?.[input.name];
    if (!before)
      throw new DevkitError(
        'not_found',
        'WORKSPACE_UNKNOWN',
        `No workspace named "${input.name}" is registered`,
        { nextSteps: ['fx workspace list'] },
      );
    const root = await this.deps.fs.realpath(path.resolve(input.root ?? before.root));
    let after: WorkspaceEntry | null = before;
    if (input.action === 'relocate') {
      await this.validateRelocation(input, before, root);
      await assertDistinctWorkspaceRoot(config, input.name, root, this.deps);
      after = { ...before, root };
    }
    if (input.action === 'rebind') {
      if (!input.source)
        throw new DevkitError('usage', 'INPUT_REQUIRED', 'Rebind requires --from', {
          nextSteps: [
            this.command('workspace', 'rebind', input.name, '--from', '<manifest-source>'),
          ],
        });
      if (!(await this.deps.fs.isDirectory(root)))
        throw new DevkitError(
          'not_found',
          'WORKSPACE_ROOT_MISSING',
          'Restore or relocate the workspace root before rebinding its source',
          {
            nextSteps: [this.command('workspace', 'relocate', input.name, '<existing-directory>')],
          },
        );
      await assertDistinctWorkspaceRoot(config, input.name, root, this.deps);
      after = { ...before, source: input.source.description };
    }
    if (input.action === 'unregister') after = null;
    return {
      id,
      name: input.name,
      action: input.action,
      before,
      after,
      root,
      phase: 'planned',
    };
  }

  private async assertPending(
    input: ManageWorkspaceInput,
    pending: OperationJournal,
  ): Promise<void> {
    if (
      pending.action !== input.action ||
      (input.root !== undefined &&
        !samePath(await this.deps.fs.realpath(path.resolve(input.root)), pending.root)) ||
      (input.source !== undefined && pending.after?.source !== input.source.description)
    )
      throw new DevkitError(
        'conflict',
        'WORKSPACE_OPERATION_PENDING',
        'A different workspace operation requires recovery first',
        {
          nextSteps: [
            `Retry workspace ${pending.action} for ${input.name} with its original arguments.`,
            `Inspect ${this.journalPath(input.name)}.`,
          ],
        },
      );
  }

  private async validateRelocation(
    input: ManageWorkspaceInput,
    before: WorkspaceEntry,
    root: string,
  ): Promise<void> {
    if (!input.root || !(await this.deps.fs.isDirectory(root)))
      throw new DevkitError(
        'not_found',
        'WORKSPACE_ROOT_MISSING',
        'Relocate requires an existing destination directory',
        {
          hint: 'Move the workspace directory with your file manager, then relocate its registration.',
          nextSteps: ['fx workspace relocate --help'],
        },
      );
    if (
      !samePath(await this.deps.fs.realpath(before.root), root) &&
      (await this.deps.fs.isDirectory(before.root))
    )
      throw new DevkitError(
        'conflict',
        'WORKSPACE_ROOT_EXISTS',
        'The registered root still exists',
        {
          nextSteps: [
            this.command('workspace', 'show', input.name),
            `Move ${before.root} to the destination before relocating the identity.`,
          ],
        },
      );
  }

  private async apply(
    initial: OperationJournal,
    input: ManageWorkspaceInput,
    checkpoints: Checkpoints,
  ): Promise<ManageWorkspaceOutput> {
    let journal = await checkpoints.save(initial);
    const home = this.deps.workspaceHomeFor(input.name);
    const sourceDir = this.deps.manifestDirFor(input.name);
    const staging = `${sourceDir}.rebind-${journal.id}`;
    const backup = this.backup(journal);
    if (journal.action === 'rebind' && !hasReached(journal, 'source_ready')) {
      await this.deps.fs.remove(staging);
      await materializeRebindSource(
        input.source!,
        { ...this.deps, workspace: input.name },
        staging,
      );
      journal = await checkpoints.save({ ...journal, phase: 'source_ready' });
    }
    let resources: readonly ResourceCleanupRow[] = [];
    if (!hasReached(journal, 'resources_cleaned')) {
      resources = await this.cleanup(journal, input, { dryRun: false });
      journal = await checkpoints.save({ ...journal, phase: 'resources_cleaned' });
    }
    if (journal.action === 'rebind' && !hasReached(journal, 'source_replaced')) {
      if (await this.deps.fs.exists(sourceDir)) await this.preserveDirectory(sourceDir, backup);
      await this.deps.fs.replaceDir(staging, sourceDir);
      journal = await checkpoints.save({ ...journal, phase: 'source_replaced' });
    }
    if (journal.action === 'unregister') await this.preserveDirectory(home, backup);
    if (!hasReached(journal, 'registered')) {
      await this.deps.config.update(async (current) => {
        const observed = current.workspaces?.[input.name] ?? null;
        if (!sameEntry(observed, journal.before) && !sameEntry(observed, journal.after))
          throw changedRegistry();
        const workspaces = { ...current.workspaces };
        if (journal.after) {
          await assertDistinctWorkspaceRoot(current, input.name, journal.after.root, this.deps);
          workspaces[input.name] = journal.after;
        } else delete workspaces[input.name];
        const next = { ...current, workspaces };
        if (!journal.after && next.default_workspace === input.name) delete next.default_workspace;
        return next;
      });
      journal = await checkpoints.save({ ...journal, phase: 'registered' });
    }
    if (journal.action === 'rebind') await this.deps.fs.remove(staging);
    if (journal.action === 'unregister' && !(await this.sharedRoots(journal)).length)
      await this.deps.fs.remove(home);
    else await this.deps.fs.remove(this.journalPath(input.name));
    return this.output(journal, { resources, written: true });
  }

  private async assertCurrentIdentity(journal: OperationJournal): Promise<void> {
    const observed = (await this.deps.config.read()).workspaces?.[journal.name] ?? null;
    if (!matchesRegistry(journal, observed)) throw changedRegistry();
  }

  private async preserveDirectory(source: string, backup: string): Promise<void> {
    if (await this.deps.fs.exists(backup)) return;
    const staged = `${backup}.pending`;
    await this.deps.fs.remove(staged);
    await this.deps.fs.copyDir(source, staged);
    await this.deps.fs.replaceDir(staged, backup);
    await this.deps.fs.remove(staged);
  }

  private async cleanup(
    journal: OperationJournal,
    input: ManageWorkspaceInput,
    options: { readonly dryRun: boolean },
  ): Promise<readonly ResourceCleanupRow[]> {
    if (hasReached(journal, 'resources_cleaned')) return [];
    await this.assertCurrentIdentity(journal);
    return this.deps.resources.cleanup({
      name: input.name,
      root: journal.root,
      ownershipRoot: await this.deps.fs.realpath(journal.before.root),
      manifestDir: this.deps.manifestDirFor(input.name),
      shared: await this.sharedRoots(journal),
      dryRun: options.dryRun,
      posture: input.posture,
    });
  }
  private async sharedRoots(journal: OperationJournal) {
    const shared: { name: string; manifestDir: string }[] = [];
    for (const [name, entry] of Object.entries((await this.deps.config.read()).workspaces ?? {}))
      if (name !== journal.name && samePath(await this.deps.fs.realpath(entry.root), journal.root))
        shared.push({ name, manifestDir: this.deps.manifestDirFor(name) });
    return shared;
  }

  private async output(
    journal: OperationJournal,
    result: { readonly resources: readonly ResourceCleanupRow[]; readonly written: boolean },
  ): Promise<ManageWorkspaceOutput> {
    const { resources, written } = result;
    const backup = await this.retainedBackup(journal);
    const prior =
      journal.action === 'unregister'
        ? this.deps.workspaceHomeFor(journal.name)
        : this.deps.manifestDirFor(journal.name);
    const planned =
      !written &&
      !backup &&
      journal.action !== 'relocate' &&
      journal.phase === 'planned' &&
      (await this.deps.fs.exists(prior));
    return {
      operation: journal.action,
      name: journal.name,
      before: journal.before,
      after: journal.after,
      checkouts: 'preserved',
      personal_scope: 'preserved',
      global_tools_and_skills: 'preserved',
      resources,
      backup,
      planned_backup: planned ? this.backup(journal) : null,
      source_validation: journal.action === 'rebind' && !written ? 'pending_apply' : null,
      next_steps: journal.after
        ? [
            this.command('sync', '--workspace', journal.name),
            this.command('workspace', 'show', journal.name),
          ]
        : ['fx workspace list'],
      written,
    };
  }
  private async retainedBackup(journal: OperationJournal): Promise<string | null> {
    if (journal.action === 'relocate') return null;
    const backup = this.backup(journal);
    return (await this.deps.fs.isDirectory(backup)) ? backup : null;
  }
  private backup(journal: OperationJournal): string {
    return journal.action === 'unregister'
      ? `${this.deps.workspaceHomeFor(journal.name)}.retired-${journal.id}`
      : `${this.deps.manifestDirFor(journal.name)}.backup-${journal.id}`;
  }
  private journalPath(name: string): string {
    return operationJournalPath(this.deps.workspaceHomeFor(name));
  }
  private async readJournal(name: string): Promise<OperationJournal | null> {
    const text = await this.deps.fs.readText(this.journalPath(name));
    if (text === undefined) return null;
    const journal = parseJournal(text, name);
    if (!journal) throw changedRegistry();
    return journal;
  }
}

// Writes the checkpoints of one run and knows the last phase that reached disk,
// which is what a failed run reports.
class Checkpoints {
  private last: OperationPhase | null = null;

  constructor(
    private readonly fs: FileSystem,
    private readonly file: string,
  ) {}

  get persisted(): OperationPhase | null {
    return this.last;
  }

  async save(journal: OperationJournal): Promise<OperationJournal> {
    await this.fs.writeText(this.file, serializeJournal(journal));
    this.last = journal.phase;
    return journal;
  }
}

function changedRegistry(): DevkitError {
  return new DevkitError(
    'conflict',
    'WORKSPACE_PLAN_CHANGED',
    'Workspace registration or recovery state changed',
    { nextSteps: ['fx workspace list', 'Re-run the same command against the current state.'] },
  );
}
