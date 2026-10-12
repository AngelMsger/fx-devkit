// Keep the root go.work in step with the Go modules checked out in the workspace,
// when the manifest asks for one. A selected repository counts once its checkout
// has a go.mod, so the file never names a module that is missing. Only a go.work
// fx wrote is replaced or removed; a person's own is reported and left alone.

import path from 'node:path';

import { DevkitError, withPartialResult } from '../../domain/errors.js';
import {
  GO_WORK,
  goDirective,
  isDerivedGoWork,
  renderGoWork,
  type GoModule,
} from '../../domain/workspace/go-work.js';
import type { ProjectionSnapshot } from '../../ports/projection.js';
import { assertWritable, type WritePosture } from '../safety/posture.js';

import type { WorkspaceDeps } from './deps.js';
import { checkoutDir } from './inspect.js';

export interface GoWorkInput {
  readonly dryRun: boolean;
  readonly posture: WritePosture;
}

export interface GoWorkFile {
  readonly path: string;
  readonly action: 'created' | 'updated' | 'removed' | 'unchanged' | 'foreign';
  readonly result: 'planned' | 'done' | 'skipped';
}

export interface GoWorkOutput {
  readonly enabled: boolean;
  readonly modules: readonly GoModule[];
  // Null when the manifest asks for no go.work and fx owns none to retire.
  readonly file: GoWorkFile | null;
}

export function goWorkspaceEnabled(deps: Pick<WorkspaceDeps, 'ctx'>): boolean {
  return deps.ctx.manifest.workspace.result.doc.go?.workspace === true;
}

export async function syncGoWork(deps: WorkspaceDeps, input: GoWorkInput): Promise<GoWorkOutput> {
  const { ctx, projections, reporter } = deps;
  const enabled = goWorkspaceEnabled(deps);
  const modules = enabled ? await checkedOutModules(deps) : [];
  const text = renderGoWork(modules);
  const at = { root: ctx.root, relative: GO_WORK };
  const before = await projections.read(at);
  const action = actionFor(before, text, enabled);
  if (action === undefined) return { enabled, modules, file: null };
  const file: GoWorkFile = {
    path: path.join(ctx.root, GO_WORK),
    action,
    result: ['unchanged', 'foreign'].includes(action) ? 'skipped' : 'planned',
  };
  if (action === 'foreign')
    reporter.notice({
      code: 'GO_WORK_FOREIGN',
      message: `${file.path} was not written by fx and left alone`,
      nextSteps: ['Move the file aside if fx should keep it, then `fx sync --only go`.'],
    });
  if (input.dryRun || file.result !== 'planned') return { enabled, modules, file };
  assertWritable(input.posture, 'go.work');
  const written = await projections.write({ ...at, before, text });
  if (written === 'conflict' || written === 'busy')
    throw withPartialResult(
      new DevkitError('conflict', 'GO_WORK_WRITE_CONFLICT', `${file.path} changed during sync`, {
        hint: 'A concurrent edit or a non-regular path is preserved.',
        nextSteps: ['Inspect the reported path, then run `fx sync --only go` again.'],
      }),
      { enabled, modules, file: { ...file, result: 'skipped' } },
    );
  return {
    enabled,
    modules,
    file: { ...file, result: written === 'written' ? 'done' : 'skipped' },
  };
}

function actionFor(
  before: ProjectionSnapshot,
  next: string | null,
  enabled: boolean,
): GoWorkFile['action'] | undefined {
  const owned = before.kind === 'file' && before.text !== null && isDerivedGoWork(before.text);
  if (!owned) {
    if (before.kind !== 'absent') return enabled ? 'foreign' : undefined;
    return next === null ? undefined : 'created';
  }
  if (next === null) return 'removed';
  return before.text === next ? 'unchanged' : 'updated';
}

// Checkouts outside the root, such as the manifest source, stay out: a go.work
// names its modules relative to itself.
async function checkedOutModules(deps: WorkspaceDeps): Promise<GoModule[]> {
  const modules: GoModule[] = [];
  for (const repo of deps.ctx.workspace.repos) {
    const dir = checkoutDir(deps, repo);
    const relative = path.relative(deps.ctx.root, dir);
    const outside = relative === '..' || relative.startsWith(`..${path.sep}`);
    if (relative === '' || outside || path.isAbsolute(relative)) continue;
    const goMod = await deps.fs.readText(path.join(dir, 'go.mod'));
    if (goMod === undefined) continue;
    modules.push({ path: relative.split(path.sep).join('/'), go: goDirective(goMod) });
  }
  return modules;
}
