// Retire only resources whose receipts or source markers establish workspace ownership.

import path from 'node:path';

import { marker } from '../../domain/docs/derived.js';
import { DevkitError } from '../../domain/errors.js';
import { samePath } from '../../domain/path.js';
import type { FileSystem } from '../../ports/fs.js';
import { applyHarnessChange, readHarnessState } from '../harness/apply.js';
import { planHarness } from '../harness/plan.js';
import type { HarnessDeps, HarnessInput } from '../harness/types.js';
import { ReconcileHooks, type HookDeps } from '../hook/reconcile.js';
import type { WritePosture } from '../safety/posture.js';
import { teamSkillsRoot } from '../skill/observe.js';

export interface ResourceCleanupInput {
  readonly name: string;
  readonly root: string;
  readonly ownershipRoot: string;
  readonly manifestDir: string;
  readonly shared?: readonly { readonly name: string; readonly manifestDir: string }[];
  readonly dryRun: boolean;
  readonly posture: WritePosture;
}
export interface ResourceCleanupRow {
  readonly kind: string;
  readonly path: string | null;
  readonly action: string;
}
export class WorkspaceResources {
  constructor(
    private readonly fs: FileSystem,
    private readonly harness: HarnessDeps,
    private readonly hooks: HookDeps,
  ) {}

  async cleanup(input: ResourceCleanupInput): Promise<readonly ResourceCleanupRow[]> {
    if (!(await this.fs.isDirectory(input.root)))
      return [{ kind: 'workspace', path: input.root, action: 'retained_unreachable' }];
    const { harness, request, plan, hookRequest, hookPlan, files } = await this.prepare(input);
    const rows: ResourceCleanupRow[] = [
      ...plan.items.map((item) => ({ kind: item.kind, path: item.path, action: item.action })),
      ...hookPlan.items
        .filter((item) => hookRequest.removeAgents.includes(item.agent))
        .map((item) => ({ kind: 'hook', path: item.path, action: item.action })),
      ...files.map(({ kind, file, owned, retarget }) => ({
        kind,
        path: file,
        action: resourceAction(owned, retarget),
      })),
    ];
    assertCleanup(input.name, rows);
    if (input.dryRun) return rows;
    let state = await readHarnessState(harness, request, true);
    for (const change of plan.changes)
      state = await applyHarnessChange(harness, request, state, change);
    await this.harness.state.write(input.name, { ...state, root: input.root });
    const hooks = await new ReconcileHooks(this.hooks).execute({ ...hookRequest, dryRun: false });
    if (
      hooks.items.some(
        (item) =>
          hookRequest.removeAgents.includes(item.agent) &&
          ['busy', 'conflict', 'foreign', 'invalid'].includes(item.action),
      )
    )
      throw new DevkitError(
        'conflict',
        'WORKSPACE_CLEANUP_BLOCKED',
        'Hook files changed during cleanup; retry the same workspace operation.',
      );
    for (const file of files) {
      if (!file.owned) continue;
      if (file.link !== undefined) {
        if ((await this.fs.readLink(file.file)) !== file.link) throw changedResource();
        await this.fs.remove(file.file);
        if (file.retarget) await this.fs.link(file.retarget, file.file);
      } else {
        const result = await this.harness.files.write({
          root: input.root,
          relative: path.relative(input.root, file.file),
          before: { kind: 'file', text: file.text! },
          text: null,
        });
        if (result === 'conflict' || result === 'busy') throw changedResource();
      }
    }
    return rows;
  }

  private async prepare(input: ResourceCleanupInput) {
    const original = await this.harness.state.read(input.name);
    if (
      original &&
      !samePath(original.root, input.ownershipRoot) &&
      !samePath(original.root, input.root)
    )
      throw new DevkitError(
        'conflict',
        'WORKSPACE_OWNERSHIP_CONFLICT',
        'Workspace ownership belongs to a different directory.',
        { nextSteps: ['fx workspace show ' + input.name] },
      );
    const statePort = {
      read: async () => (original === null ? null : { ...original, root: input.root }),
      write: this.harness.state.write.bind(this.harness.state),
    };
    const harness = { ...this.harness, state: statePort };
    const request: HarnessInput = {
      workspace: input.name,
      root: input.root,
      harness: undefined,
      selected: [],
      action: 'sync',
      dryRun: input.dryRun,
      yes: false,
      posture: input.posture,
    };
    const state = await readHarnessState(harness, request, false);
    const planned = await planHarness(harness, request, state);
    const plan = await this.preserveShared(input, state, planned);
    const hookState = await this.hooks.state.read(input.name);
    const hookRequest = {
      workspace: input.name,
      root: input.root,
      ownershipRoot: input.ownershipRoot,
      action: 'sync' as const,
      globalEnabled: true,
      configured: [],
      dryRun: true,
      posture: input.posture,
      removeAgents: hookState?.receipts.map((receipt) => receipt.agent) ?? [],
    };
    const hookPlan = await new ReconcileHooks(this.hooks).execute(hookRequest);
    const files = await this.files(input);
    return { harness, request, plan, hookRequest, hookPlan, files };
  }

  private async preserveShared(
    input: ResourceCleanupInput,
    state: Awaited<ReturnType<typeof readHarnessState>>,
    planned: Awaited<ReturnType<typeof planHarness>>,
  ) {
    const sharedReceipts = (
      await Promise.all((input.shared ?? []).map((owner) => this.harness.state.read(owner.name)))
    ).flatMap((owner) => owner?.receipts ?? []);
    const shared = new Set(
      state.receipts
        .filter((receipt) =>
          sharedReceipts.some(
            (other) => other.key === receipt.key && other.digest === receipt.digest,
          ),
        )
        .map((receipt) => receipt.key),
    );
    return {
      ...planned,
      items: planned.items.map((item) =>
        shared.has(item.key) ? { ...item, action: 'preserved_shared' } : item,
      ),
      changes: planned.changes.map((change) =>
        shared.has(change.key) ? { ...change, text: change.before.text } : change,
      ),
    };
  }

  private async files(input: ResourceCleanupInput) {
    const files: {
      kind: string;
      file: string;
      owned: boolean;
      link?: string;
      text?: string;
      retarget?: string;
    }[] = [];
    for (const file of ['AGENTS.md', 'CLAUDE.md']) {
      const at = path.join(input.root, file);
      const before = await this.harness.files.read({ root: input.root, relative: file });
      if (before.kind === 'absent') continue;
      files.push({
        kind: 'guide',
        file: at,
        owned:
          !input.shared?.length &&
          before.kind === 'file' &&
          before.text !== null &&
          before.text.startsWith(marker(path.join(input.manifestDir, 'AGENTS.md'))),
        ...(before.text === null ? {} : { text: before.text }),
      });
    }
    const target = teamSkillsRoot(input.manifestDir);
    const successor =
      input.shared?.length === 1 ? teamSkillsRoot(input.shared[0]!.manifestDir) : undefined;
    const retarget = successor && (await this.fs.isDirectory(successor)) ? successor : undefined;
    for (const at of new Set(
      this.harness.hosts.map((host) => host.skillsDir('project', input.root)),
    )) {
      const link = await this.fs.readLink(at);
      if (link === undefined && !(await this.fs.exists(at))) continue;
      files.push({
        kind: 'team_skills',
        file: at,
        owned: link !== undefined && samePath(path.resolve(path.dirname(at), link), target),
        ...(link === undefined ? {} : { link }),
        ...(retarget && link !== undefined && samePath(path.resolve(path.dirname(at), link), target)
          ? { retarget }
          : {}),
      });
    }
    return files;
  }
}
function changedResource(): DevkitError {
  return new DevkitError(
    'conflict',
    'WORKSPACE_CLEANUP_CHANGED',
    'A managed resource changed during cleanup; retry the same workspace operation.',
  );
}

function assertCleanup(name: string, rows: readonly ResourceCleanupRow[]): void {
  const blocked = rows.filter((item) =>
    ['foreign', 'invalid', 'conflict', 'unsupported', 'busy'].includes(item.action),
  );
  if (blocked.length)
    throw new DevkitError(
      'conflict',
      'WORKSPACE_CLEANUP_BLOCKED',
      'Owned workspace resources could not be safely retired.',
      {
        hint: 'Restore the owned native entries or resolve the reported file conflicts, then retry. Registration and recovery metadata are retained.',
        nextSteps: ['fx workspace show ' + name, 'fx hook list --workspace ' + name],
        partialResult: { resources: rows },
      },
    );
}

function resourceAction(owned: boolean, retarget?: string): string {
  if (retarget) return 'retarget_shared';
  return owned ? 'remove' : 'preserved';
}
