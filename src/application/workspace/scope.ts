// Editing one list of the personal layer's scope (repos or envs). "All"
// (the key absent) and an explicit list are different things: picking under
// "all" changes nothing, unpicking under "all" has to spell the list out
// first, and an explicit list stays explicit.

import type { DevkitError } from '../../domain/errors.js';
import type { LocalLayer } from '../../domain/manifest/types.js';
import { assertWritable, type WritePosture } from '../safety/posture.js';

import type { WorkspaceDeps } from './deps.js';

export type ScopeKey = 'repos' | 'envs';

export interface ScopeEdit {
  readonly key: ScopeKey;
  readonly operation: 'pick' | 'unpick';
  readonly universe: readonly string[];
  readonly names: readonly string[];
  readonly dryRun: boolean;
  readonly posture: WritePosture;
  readonly notFound: (name: string) => DevkitError;
}

export interface ScopeOutput {
  readonly path: string;
  readonly before: readonly string[] | null;
  readonly after: readonly string[] | null;
  readonly changed: boolean;
  readonly written: boolean;
  readonly reason?: string;
}

export async function editScope(deps: WorkspaceDeps, edit: ScopeEdit): Promise<ScopeOutput> {
  for (const name of edit.names) if (!edit.universe.includes(name)) throw edit.notFound(name);
  const local = await deps.localStore.read(deps.ctx.name);
  const before = local.scope?.[edit.key] ?? null;
  const next = nextList(before, edit);
  const plan: ScopeOutput = {
    path: deps.localStore.path(deps.ctx.name),
    before,
    after: next.after,
    changed: next.changed,
    written: false,
    ...(next.reason === undefined ? {} : { reason: next.reason }),
  };
  if (edit.dryRun || !next.changed) return plan;
  assertWritable(edit.posture, `${edit.key} ${edit.operation}`);
  const layer: LocalLayer = {
    ...local,
    scope: { ...local.scope, [edit.key]: [...(next.after ?? [])] },
  };
  await deps.localStore.write(deps.ctx.name, layer);
  return { ...plan, written: true };
}

function nextList(
  before: readonly string[] | null,
  edit: ScopeEdit,
): { after: readonly string[] | null; changed: boolean; reason?: string } {
  if (edit.operation === 'pick') {
    if (before === null)
      return {
        after: null,
        changed: false,
        reason: `every ${edit.key === 'repos' ? 'shared repository' : 'environment'} is already in scope`,
      };
    const after = [...before, ...edit.names.filter((n) => !before.includes(n))];
    return { after, changed: after.length !== before.length };
  }
  const base = before ?? edit.universe;
  const after = base.filter((n) => !edit.names.includes(n));
  return { after, changed: before === null || after.length !== base.length };
}
