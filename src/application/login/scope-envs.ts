// Which environments this person cares about: asked once, on the first guided setup, and
// kept in the personal layer. Nothing is asked when there is nobody to ask; the whole
// set is used and a notice says how to narrow it.

import type { Prompter } from '../../ports/prompter.js';
import { envNotFound } from '../env/names.js';
import { assertWritable, type WritePosture } from '../safety/posture.js';
import type { WorkspaceDeps } from '../workspace/deps.js';
import { workspaceCommand } from '../workspace/guidance.js';

export interface ScopeEnvsInput {
  readonly noInput: boolean;
  readonly dryRun: boolean;
  readonly posture: WritePosture;
}

export async function ensureScopeEnvs(
  deps: WorkspaceDeps,
  prompter: Prompter,
  input: ScopeEnvsInput,
): Promise<readonly string[] | undefined> {
  const chosen = deps.ctx.local.scope?.envs;
  if (chosen !== undefined) return chosen;
  const names = Object.keys(deps.ctx.manifest.environments?.result.doc.envs ?? {});
  if (names.length === 0) return undefined;
  if (input.noInput) {
    deps.reporter.notice({
      code: 'SCOPE_ENVS_UNSET',
      message: `All declared environments are selected: ${names.join(', ')}. Use env select to narrow the scope.`,
      nextSteps: [workspaceCommand(deps, 'env', 'select', '<env...>')],
    });
    return undefined;
  }
  const answer = await prompter.ask(
    `Which environments do you use? Comma-separated from ${names.join(', ')} (empty = all)`,
  );
  const picked = answer
    .split(',')
    .map((n) => n.trim())
    .filter((n) => n !== '');
  for (const name of picked) if (!names.includes(name)) throw envNotFound(deps, name, names);
  if (picked.length === 0) return undefined;
  const envs = [...new Set(picked)];
  if (input.dryRun) return envs;
  assertWritable(input.posture, 'env select');
  await deps.localStore.update(deps.ctx.name, (local) => ({
    ...local,
    scope: { ...local.scope, envs: [...envs] },
  }));
  return envs;
}
