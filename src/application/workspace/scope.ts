// Edit repository and environment scope while preserving dynamic all and explicit selections.

import { DevkitError } from '../../domain/errors.js';
import type { LocalLayer } from '../../domain/manifest/types.js';
import { shellLine } from '../../domain/shell.js';
import { assertWritable, type WritePosture } from '../safety/posture.js';

import type { WorkspaceDeps } from './deps.js';
import { validateWorkspaceLayer } from './validate-layer.js';

export type ScopeOperation = 'pick' | 'unpick' | 'replace' | 'all' | 'none';
export type ScopeMode = 'all' | 'explicit' | 'none';

export function scopeMode(names: readonly string[] | null | undefined): ScopeMode {
  if (names === null || names === undefined) return 'all';
  return names.length === 0 ? 'none' : 'explicit';
}

export type ScopeKey = 'repos' | 'envs';

export interface ScopeEdit {
  readonly key: ScopeKey;
  readonly operation: ScopeOperation;
  readonly universe: readonly string[];
  readonly names: readonly string[];
  readonly dryRun: boolean;
  readonly posture: WritePosture;
  readonly notFound: (name: string) => DevkitError;
}

export interface ScopeOutput {
  readonly scope: 'workspace';
  readonly workspace: string;
  readonly path: string;
  readonly before: readonly string[] | null;
  readonly after: readonly string[] | null;
  readonly before_mode: ScopeMode;
  readonly mode: ScopeMode;
  readonly next_steps: readonly string[];
  readonly changed: boolean;
  readonly written: boolean;
  readonly reason?: string;
}

export async function editScope(deps: WorkspaceDeps, edit: ScopeEdit): Promise<ScopeOutput> {
  if ((edit.operation === 'all' || edit.operation === 'none') && edit.names.length > 0)
    throw new DevkitError(
      'usage',
      'INPUT_INVALID',
      'Names cannot be combined with --all or --none',
    );
  if (edit.operation === 'replace' && edit.names.length === 0)
    throw new DevkitError('usage', 'INPUT_REQUIRED', 'Select names, --all, or --none', {
      nextSteps: [`fx ${edit.key === 'repos' ? 'repo' : 'env'} select --help`],
    });
  for (const name of edit.names) if (!edit.universe.includes(name)) throw edit.notFound(name);
  let planned = await planEdit(deps, edit, await deps.localStore.read(deps.ctx.name));
  if (edit.dryRun || !planned.output.changed) return planned.output;
  assertWritable(edit.posture, `${edit.key} ${edit.operation}`);
  await deps.localStore.update(deps.ctx.name, async (current) => {
    planned = await planEdit(deps, edit, current);
    return planned.layer;
  });
  return { ...planned.output, written: true };
}

async function planEdit(
  deps: WorkspaceDeps,
  edit: ScopeEdit,
  local: LocalLayer,
): Promise<{ output: ScopeOutput; layer: LocalLayer }> {
  const before = local.scope?.[edit.key] ?? null;
  const next = nextList(before, edit);
  const plan: ScopeOutput = {
    scope: 'workspace',
    workspace: deps.ctx.name,
    path: deps.localStore.path(deps.ctx.name),
    before,
    after: next.after,
    before_mode: scopeMode(before),
    mode: scopeMode(next.after),
    next_steps: [
      shellLine(
        [
          'fx',
          ...(edit.key === 'repos' ? ['sync'] : ['env', 'list']),
          '--workspace',
          deps.ctx.name,
        ],
        deps.commandShell,
      ),
    ],
    changed: next.changed,
    written: false,
    ...(next.reason === undefined ? {} : { reason: next.reason }),
  };
  const scope = { ...local.scope };
  if (next.after === null) delete scope[edit.key];
  else scope[edit.key] = [...next.after];
  const layer: LocalLayer = { ...local, scope };
  await validateWorkspaceLayer(
    deps.fs,
    deps.ctx.root,
    deps.ctx.manifest.workspace.result.doc,
    layer,
    deps.ctx.workspace.repos.find((repo) => repo.origin === 'manifest'),
  );
  return { output: plan, layer };
}

function nextList(
  before: readonly string[] | null,
  edit: ScopeEdit,
): { after: readonly string[] | null; changed: boolean; reason?: string } {
  if (edit.operation === 'all') return { after: null, changed: before !== null };
  if (edit.operation === 'replace' || edit.operation === 'none') {
    const after = edit.operation === 'none' ? [] : [...new Set(edit.names)];
    return { after, changed: JSON.stringify(before) !== JSON.stringify(after) };
  }
  if (edit.operation === 'pick') {
    if (before === null)
      return {
        after: null,
        changed: false,
        reason: `every ${edit.key === 'repos' ? 'shared repository' : 'environment'} is already in scope`,
      };
    const after = [...new Set([...before, ...edit.names])];
    return { after, changed: after.length !== before.length };
  }
  const base = before ?? edit.universe;
  const after = base.filter((n) => !edit.names.includes(n));
  return { after, changed: before === null || after.length !== base.length };
}

export function selectOperation(all: boolean, none: boolean): ScopeOperation {
  if (all) return 'all';
  return none ? 'none' : 'replace';
}
