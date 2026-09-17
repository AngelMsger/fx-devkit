// Build the shared synchronization plan from checkout facts; offline previews do not query providers or mutate caches.
import { DevkitError } from '../../domain/errors.js';
import {
  planSync,
  type DiskState,
  type PlanItem,
  type Readability,
} from '../../domain/workspace/plan.js';
import { pooled } from '../pool.js';

import type { WorkspaceDeps } from './deps.js';
import { inspectDisk, readabilityOf, resolveUser, urlsFor } from './inspect.js';

export interface RepositoryPlanInput {
  readonly jobs: number;
  readonly remote?: boolean;
  readonly active?: Set<string>;
  readonly complete?: () => void;
}

export async function planRepositories(
  deps: WorkspaceDeps,
  input: RepositoryPlanInput,
): Promise<readonly PlanItem[]> {
  const { jobs, active = new Set<string>(), complete = () => undefined } = input;
  const { ctx } = deps;
  const inspected = await pooled(ctx.workspace.repos, jobs, async (repo) => {
    active.add(repo.name);
    try {
      const state = await inspectDisk(deps, repo);
      const readability =
        input.remote !== false && state.kind === 'absent'
          ? await readabilityOf(deps, repo)
          : undefined;
      return { repo, state, readability };
    } finally {
      active.delete(repo.name);
      complete();
    }
  });
  const states: Record<string, DiskState> = Object.fromEntries(
    inspected.map(({ repo, state }) => [repo.name, state]),
  );
  const readability: Record<string, Readability> = Object.fromEntries(
    inspected.flatMap(({ repo, readability }) =>
      readability === undefined ? [] : [[repo.name, readability]],
    ),
  );
  const wantsOrigin = (s: DiskState): boolean =>
    s.kind === 'absent' || (s.kind === 'checkout' && s.remotes['origin'] === undefined);
  let user = deps.user;
  if (input.remote !== false && Object.values(states).some(wantsOrigin))
    user = await resolvePlanningUser(deps);
  const urls = Object.fromEntries(
    ctx.workspace.repos.map((repo) => [repo.name, urlsFor(deps, repo, user)]),
  );
  const projects = ctx.manifest.workspace.result.doc.projects ?? {};
  const contacts = Object.fromEntries(
    Object.entries(projects).flatMap(([name, p]) =>
      p.contact === undefined ? [] : [[name, p.contact]],
    ),
  );
  return planSync({
    repos: ctx.workspace.repos,
    available: ctx.workspace.available,
    states,
    readability,
    urls,
    contacts,
  }).items;
}

async function resolvePlanningUser(deps: WorkspaceDeps): Promise<string | undefined> {
  try {
    return await resolveUser(deps);
  } catch (err) {
    if (
      !(err instanceof DevkitError) ||
      ![
        'CODE_HOST_AUTH',
        'TOOL_MISSING',
        'LOGIN_REQUIRED',
        'VECTOR_UNTRUSTED',
        'PROCESS_TIMEOUT',
        'PROVIDER_UNBOUND',
        'PROVIDER_UNKNOWN',
        'PROVIDER_VAR_MISSING',
      ].includes(err.code)
    )
      throw err;
    deps.reporter.notice({
      code: 'CODE_HOST_USER_UNKNOWN',
      message: `no origin remote can be set: ${err instanceof Error ? err.message : String(err)}`,
      nextSteps: ['fx config set user <your code-host user name>', 'fx repo fork <name>'],
    });
    return undefined;
  }
}
