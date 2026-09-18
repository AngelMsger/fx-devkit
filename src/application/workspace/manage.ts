// Workspace identity changes retire owned resources and retain recovery copies before committing registration.

import { randomUUID } from 'node:crypto';
import path from 'node:path';

import { asDevkitError, busyError, DevkitError, withPartialResult } from '../../domain/errors.js';
import { samePath } from '../../domain/path.js';
import { shellLine, type ResolvedShell } from '../../domain/shell.js';
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
  readonly bundledTools: () => string;
  readonly cliVersion: string;
  readonly commandShell?: ResolvedShell | undefined;
}
export interface ManageWorkspaceInput {
  readonly name: string;
  readonly action: 'unregister' | 'relocate' | 'rebind';
  readonly root?: string;
  readonly source?: ManifestSource;
  readonly dryRun: boolean;
  readonly posture: WritePosture;
}
interface Journal {
  readonly id: string;
  readonly name: string;
  readonly action: ManageWorkspaceInput['action'];
  readonly before: WorkspaceEntry;
  readonly after: WorkspaceEntry | null;
  readonly root: string;
  readonly phase:
    'planned' | 'source_ready' | 'resources_cleaned' | 'source_replaced' | 'registered';
}
interface ApplyProgress {
  written: boolean;
  phase: Journal['phase'] | null;
}
export interface ManageWorkspaceOutput {
  readonly operation: ManageWorkspaceInput['action'];
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

  async execute(input: ManageWorkspaceInput): Promise<ManageWorkspaceOutput> {
    const preview = await this.plan(input);
    if (await this.isNoop(preview))
      return this.output({ ...preview, after: preview.before }, [], false);
    if (input.dryRun) return this.run(input);
    assertWritable(input.posture, `workspace ${input.action}`);
    return withWorkspaceOperation(this.deps.lock, input.name, false, () => this.run(input));
  }

  private async run(input: ManageWorkspaceInput): Promise<ManageWorkspaceOutput> {
    const preview = await this.plan(input);
    if (await this.isNoop(preview))
      return this.output({ ...preview, after: preview.before }, [], false);
    const validation =
      input.source && preview.phase === 'planned'
        ? await inspectRebindSource(input.source, { ...this.deps, workspace: input.name })
        : null;
    const resources = await this.cleanup(preview, input, true);
    const result = {
      ...(await this.output(preview, resources, false)),
      source_validation: validation,
    };
    if (input.dryRun) return result;
    assertWritable(input.posture, `workspace ${input.action}`);
    const lease = await this.deps.lock.acquire({ key: `workspace:${input.name}`, waitMs: 2000 });
    if (!lease)
      throw busyError('LOCK_BUSY', 'The workspace', {
        nextSteps: ['Retry the same workspace command shortly.'],
      });
    const progress: ApplyProgress = { written: false, phase: null };
    try {
      const current = await this.plan(input, preview.id);
      if (JSON.stringify(current) !== JSON.stringify(preview)) throw changedRegistry();
      return await this.apply(current, input, progress);
    } catch (error) {
      throw withPartialResult(error, {
        ...result,
        ...asDevkitError(error).partialResult,
        backup: await this.retainedBackup(preview),
        written: progress.written,
        phase: progress.phase,
        recovery: this.journalPath(input.name),
        next_steps: ['Retry the same workspace command to resume the retained operation.'],
      });
    } finally {
      await lease.release();
    }
  }

  private async isNoop(journal: Journal): Promise<boolean> {
    return (
      journal.action === 'relocate' &&
      journal.phase === 'planned' &&
      samePath(await this.deps.fs.realpath(journal.before.root), journal.root)
    );
  }

  private async plan(input: ManageWorkspaceInput, id: string = randomUUID()): Promise<Journal> {
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
        `No workspace named "${input.name}" is registered.`,
        { nextSteps: ['fx workspace list'] },
      );
    const root = await this.deps.fs.realpath(path.resolve(input.root ?? before.root));
    let after: WorkspaceEntry | null = before;
    if (input.action === 'relocate') {
      await this.validateRelocation(input, before, root);
      await assertDistinctWorkspaceRoot(config, input.name, root, this.deps.fs);
      after = { ...before, root };
    }
    if (input.action === 'rebind') {
      if (!input.source)
        throw new DevkitError('usage', 'INPUT_REQUIRED', 'Rebind requires --from.');
      if (!(await this.deps.fs.isDirectory(root)))
        throw new DevkitError(
          'not_found',
          'WORKSPACE_ROOT_MISSING',
          'Restore or relocate the workspace root before rebinding its source.',
          {
            nextSteps: [
              shellLine(['fx', 'workspace', 'relocate', input.name, '<existing-directory>']),
            ],
          },
        );
      await assertDistinctWorkspaceRoot(config, input.name, root, this.deps.fs);
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

  private async assertPending(input: ManageWorkspaceInput, pending: Journal): Promise<void> {
    if (
      pending.action !== input.action ||
      (input.root !== undefined &&
        !samePath(await this.deps.fs.realpath(path.resolve(input.root)), pending.root)) ||
      (input.source !== undefined && pending.after?.source !== input.source.description)
    )
      throw new DevkitError(
        'conflict',
        'WORKSPACE_OPERATION_PENDING',
        'A different workspace operation requires recovery first.',
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
        'Relocate requires an existing destination directory.',
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
        'The registered root still exists. Move it before relocating its identity.',
        { nextSteps: [shellLine(['fx', 'workspace', 'show', input.name])] },
      );
  }

  private async apply(initial: Journal, input: ManageWorkspaceInput, progress: ApplyProgress) {
    let journal = initial;
    const save = async (phase: Journal['phase']) => {
      const next = { ...journal, phase };
      await this.deps.fs.writeText(this.journalPath(input.name), JSON.stringify(next));
      journal = next;
      progress.written = true;
      progress.phase = phase;
    };
    await save(journal.phase);
    const sourceDir = this.deps.manifestDirFor(input.name);
    const staging = `${sourceDir}.rebind-${journal.id}`;
    const backup = this.backup(journal);
    if (journal.action === 'rebind' && journal.phase === 'planned') {
      await this.deps.fs.remove(staging);
      await materializeRebindSource(
        input.source!,
        { ...this.deps, workspace: input.name },
        staging,
      );
      await save('source_ready');
    }
    let resources: readonly ResourceCleanupRow[] = [];
    if (journal.phase === 'planned' || journal.phase === 'source_ready') {
      resources = await this.cleanup(journal, input, false);
      await save('resources_cleaned');
    }
    if (journal.action === 'rebind' && journal.phase === 'resources_cleaned') {
      if (await this.deps.fs.exists(sourceDir)) await this.preserveDirectory(sourceDir, backup);
      await this.deps.fs.replaceDir(staging, sourceDir);
      await save('source_replaced');
    }
    if (journal.action === 'unregister')
      await this.preserveDirectory(path.dirname(sourceDir), backup);
    if (journal.phase !== 'registered') {
      await this.deps.config.update(async (current) => {
        const observed = current.workspaces?.[input.name] ?? null;
        if (
          JSON.stringify(observed) !== JSON.stringify(journal.before) &&
          JSON.stringify(observed) !== JSON.stringify(journal.after)
        )
          throw changedRegistry();
        const workspaces = { ...current.workspaces };
        if (journal.after) {
          await assertDistinctWorkspaceRoot(current, input.name, journal.after.root, this.deps.fs);
          workspaces[input.name] = journal.after;
        } else delete workspaces[input.name];
        const next = { ...current, workspaces };
        if (!journal.after && next.default_workspace === input.name) delete next.default_workspace;
        return next;
      });
      await save('registered');
    }
    if (journal.action === 'rebind') await this.deps.fs.remove(staging);
    if (journal.action === 'unregister' && !(await this.sharedRoots(journal)).length)
      await this.deps.fs.remove(path.dirname(sourceDir));
    else await this.deps.fs.remove(this.journalPath(input.name));
    return this.output(journal, resources, true);
  }

  private async assertCurrentIdentity(journal: Journal): Promise<void> {
    const observed = (await this.deps.config.read()).workspaces?.[journal.name] ?? null;
    const before = JSON.stringify(observed) === JSON.stringify(journal.before);
    const after = JSON.stringify(observed) === JSON.stringify(journal.after);
    if (
      journal.phase === 'registered'
        ? !after
        : !before && !(after && ['resources_cleaned', 'source_replaced'].includes(journal.phase))
    )
      throw changedRegistry();
  }

  private async preserveDirectory(source: string, backup: string): Promise<void> {
    if (await this.deps.fs.exists(backup)) return;
    const staged = `${backup}.pending`;
    await this.deps.fs.remove(staged);
    await this.deps.fs.copyDir(source, staged);
    await this.deps.fs.replaceDir(staged, backup);
    await this.deps.fs.remove(staged);
  }

  private async cleanup(journal: Journal, input: ManageWorkspaceInput, dryRun: boolean) {
    if (
      journal.phase === 'registered' ||
      journal.phase === 'source_replaced' ||
      journal.phase === 'resources_cleaned'
    )
      return Promise.resolve([]);
    await this.assertCurrentIdentity(journal);
    return this.deps.resources.cleanup({
      name: input.name,
      root: journal.root,
      ownershipRoot: await this.deps.fs.realpath(journal.before.root),
      manifestDir: this.deps.manifestDirFor(input.name),
      shared: await this.sharedRoots(journal),
      dryRun,
      posture: input.posture,
    });
  }
  private async sharedRoots(journal: Journal) {
    const shared: { name: string; manifestDir: string }[] = [];
    for (const [name, entry] of Object.entries((await this.deps.config.read()).workspaces ?? {}))
      if (name !== journal.name && samePath(await this.deps.fs.realpath(entry.root), journal.root))
        shared.push({ name, manifestDir: this.deps.manifestDirFor(name) });
    return shared;
  }

  private async output(
    journal: Journal,
    resources: readonly ResourceCleanupRow[],
    written: boolean,
  ): Promise<ManageWorkspaceOutput> {
    const backup = await this.retainedBackup(journal);
    const source = this.deps.manifestDirFor(journal.name);
    const prior = journal.action === 'unregister' ? path.dirname(source) : source;
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
            shellLine(['fx', 'sync', '--workspace', journal.name]),
            shellLine(['fx', 'workspace', 'show', journal.name]),
          ]
        : ['fx workspace list'],
      written,
    };
  }
  private async retainedBackup(journal: Journal): Promise<string | null> {
    if (journal.action === 'relocate') return null;
    const backup = this.backup(journal);
    return (await this.deps.fs.isDirectory(backup)) ? backup : null;
  }
  private backup(journal: Journal): string {
    const source = this.deps.manifestDirFor(journal.name);
    return journal.action === 'unregister'
      ? `${path.dirname(source)}.retired-${journal.id}`
      : `${source}.backup-${journal.id}`;
  }
  private journalPath(name: string) {
    return path.join(path.dirname(this.deps.manifestDirFor(name)), 'workspace-operation.json');
  }
  private async readJournal(name: string): Promise<Journal | null> {
    const text = await this.deps.fs.readText(this.journalPath(name));
    if (text === undefined) return null;
    let value: Journal;
    try {
      value = JSON.parse(text) as Journal;
    } catch {
      throw changedRegistry();
    }
    if (
      !value ||
      typeof value !== 'object' ||
      value.name !== name ||
      !/^[a-f0-9-]{36}$/.test(value.id) ||
      !['unregister', 'relocate', 'rebind'].includes(value.action) ||
      typeof value.before?.root !== 'string' ||
      typeof value.root !== 'string' ||
      !validTransition(value) ||
      !['planned', 'source_ready', 'resources_cleaned', 'source_replaced', 'registered'].includes(
        value.phase,
      )
    )
      throw changedRegistry();
    return value;
  }
}
function changedRegistry(): DevkitError {
  return new DevkitError(
    'conflict',
    'WORKSPACE_PLAN_CHANGED',
    'Workspace registration or recovery state changed. Inspect it and retry.',
    { nextSteps: ['fx workspace list'] },
  );
}

function validTransition(journal: Journal): boolean {
  if (journal.action === 'unregister') return journal.after === null;
  if (typeof journal.after?.root !== 'string') return false;
  if (journal.action === 'relocate')
    return journal.after.root === journal.root && journal.after.source === journal.before.source;
  return journal.after.root === journal.before.root && typeof journal.after.source === 'string';
}
