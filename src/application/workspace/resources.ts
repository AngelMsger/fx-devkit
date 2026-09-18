// Retire only resources whose receipts or source markers establish workspace ownership.

import path from 'node:path';

import { marker } from '../../domain/docs/derived.js';
import { DevkitError } from '../../domain/errors.js';
import { samePath } from '../../domain/path.js';
import type { FileSystem } from '../../ports/fs.js';
import type { LinkProjectionStore } from '../../ports/projection.js';
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
    private readonly links: LinkProjectionStore,
  ) {}

  async cleanup(input: ResourceCleanupInput): Promise<readonly ResourceCleanupRow[]> {
    if (!(await this.fs.isDirectory(input.root)))
      return [{ kind: 'workspace', path: input.root, action: 'retained_unreachable' }];
    const { harness, request, plan, hookRequest, hookPlan, files, shared } =
      await this.prepare(input);
    const rows: ResourceCleanupRow[] = [
      ...plan.items.map((item) => ({ kind: item.kind, path: item.path, action: item.action })),
      ...shared.map((item) => ({
        kind: item.kind,
        path: item.relative,
        action: 'preserved_shared',
      })),
      ...hookPlan.items
        .filter((item) => hookRequest.removeAgents.includes(item.agent))
        .map((item) => ({ kind: 'hook', path: item.path, action: item.action })),
      ...files.map(({ kind, file, owned, retarget, blocked }) => ({
        kind,
        path: file,
        action: resourceAction(owned, retarget, blocked),
      })),
    ];
    assertCleanup(input.name, rows);
    if (input.dryRun) return rows;
    let state = await readHarnessState(harness, request, true);
    for (const change of plan.changes)
      state = await applyHarnessChange(harness, request, state, change);
    await this.harness.state.write(input.name, {
      ...state,
      root: input.root,
      receipts: state.receipts.filter(
        (receipt) => !shared.some((other) => other.key === receipt.key),
      ),
    });
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
    await this.retireFiles(input.root, files);
    return rows;
  }

  private async retireFiles(
    root: string,
    files: Awaited<ReturnType<WorkspaceResources['files']>>,
  ): Promise<void> {
    for (const file of files) {
      if (!file.owned) continue;
      if (file.link !== undefined) {
        const result = await this.links.writeLink({
          root,
          relative: path.relative(root, file.file),
          before: { kind: 'link', target: file.link },
          target: file.retarget ?? null,
        });
        if (result === 'conflict' || result === 'busy') throw changedResource();
      } else {
        const result = await this.harness.files.write({
          root: root,
          relative: path.relative(root, file.file),
          before: { kind: 'file', text: file.text! },
          text: null,
        });
        if (result === 'conflict' || result === 'busy') throw changedResource();
      }
    }
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
    const shared = await this.sharedReceipts(input, state);
    const plan = await planHarness(harness, request, {
      ...state,
      receipts: state.receipts.filter(
        (receipt) => !shared.some((other) => other.key === receipt.key),
      ),
    });
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
    return { harness, request, plan, hookRequest, hookPlan, files, shared };
  }

  private async sharedReceipts(
    input: ResourceCleanupInput,
    state: Awaited<ReturnType<typeof readHarnessState>>,
  ) {
    const otherReceipts = (
      await Promise.all((input.shared ?? []).map((owner) => this.harness.state.read(owner.name)))
    ).flatMap((owner) => owner?.receipts ?? []);
    return state.receipts.filter((receipt) =>
      otherReceipts.some((other) => other.key === receipt.key && other.digest === receipt.digest),
    );
  }

  private async files(input: ResourceCleanupInput) {
    const files: {
      kind: string;
      file: string;
      owned: boolean;
      link?: string;
      text?: string;
      retarget?: string;
      blocked?: boolean;
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
      const observed = await this.links.readLink({
        root: input.root,
        relative: path.relative(input.root, at),
      });
      if (observed.kind === 'absent') continue;
      const link = observed.target ?? undefined;
      files.push({
        kind: 'team_skills',
        file: at,
        blocked: observed.kind === 'unsafe',
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

function resourceAction(owned: boolean, retarget?: string, blocked?: boolean): string {
  if (blocked) return 'foreign';
  if (retarget) return 'retarget_shared';
  return owned ? 'remove' : 'preserved';
}
