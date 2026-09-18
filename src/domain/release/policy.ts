// What "a release" means for one repository, resolved from the manifest alone
// so a personal checkout override cannot change a team report; see "Policy
// resolution" in docs/design/release.md.

import type { Repo, Workspace } from '../manifest/types.js';

export interface CiEnvs {
  readonly sourceEnv: string;
  readonly targetEnv: string;
}

export interface ReleasePolicy {
  readonly covered: boolean;
  readonly source: string | undefined;
  readonly targets: readonly string[];
  readonly env: string | undefined;
  readonly since: string;
  readonly ci: CiEnvs | undefined;
  readonly bots: readonly string[];
}

export const DEFAULT_TARGETS = ['main', 'master'] as const;
export const DEFAULT_SINCE = '14d';

// A repository the manifest does not list (a machine-local one) is never on
// the checklist.
const OFF: ReleasePolicy = {
  covered: false,
  source: undefined,
  targets: DEFAULT_TARGETS,
  env: undefined,
  since: DEFAULT_SINCE,
  ci: undefined,
  bots: [],
};

type Shared = NonNullable<Workspace['release']>;
type Own = NonNullable<Repo['release']>;

export function releasePolicyOf(workspace: Workspace, name: string): ReleasePolicy {
  const repo = workspace.repos.find((r) => r.name === name);
  if (repo === undefined) return OFF;
  const shared: Shared = workspace.release ?? {};
  const own: Own = repo.release ?? {};
  return {
    covered: own.covered ?? true,
    source: own.source ?? shared.source ?? repo.branch ?? workspace.defaults.branch,
    targets: own.target === undefined ? (shared.targets ?? DEFAULT_TARGETS) : [own.target],
    env: shared.env,
    since: shared.since ?? DEFAULT_SINCE,
    ci: ciEnvsOf(shared, own),
    bots: shared.bots ?? [],
  };
}

function ciEnvsOf(shared: Shared, own: Own): CiEnvs | undefined {
  const sourceEnv = own.ci?.source_env ?? shared.ci?.source_env;
  const targetEnv = own.ci?.target_env ?? shared.ci?.target_env;
  return sourceEnv === undefined || targetEnv === undefined ? undefined : { sourceEnv, targetEnv };
}
