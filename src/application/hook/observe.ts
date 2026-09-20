// What each background phase does, in which order, and what its result means.
// A phase answers with dated codes rather than with its use case's result,
// because the hook stores evidence a later command reads, not a report.

import type { HookObservation } from '../../domain/harness/state.js';
import type { Clock } from '../../ports/clock.js';
import type { Lease } from '../../ports/lock.js';
import type { ManifestSource } from '../../ports/manifest-source.js';
import type { Reporter } from '../../ports/reporter.js';
import type { ConfigStore } from '../../ports/stores.js';
import { readSettings } from '../config/settings.js';
import { DeriveDocs } from '../docs/derive.js';
import { checkLogin } from '../doctor/login.js';
import type { HarnessSession } from '../harness/session.js';
import { manageHarness } from '../harness/stages.js';
import type { LoginDeps } from '../login/deps.js';
import { RefreshManifest } from '../refresh-manifest.js';
import { SkillStage } from '../skill/stage.js';
import type { SkillDeps } from '../skill/targets.js';
import { toolchainOf } from '../tool/toolchain.js';
import type { FxUpdateCheck } from '../update/fx.js';
import type { ManifestUpdateCheck } from '../update/manifest.js';
import type { WorkspaceDeps } from '../workspace/deps.js';

import type { AutomaticSyncDeps } from './automatic-sync.js';

export interface BackgroundDeps {
  readonly clock: Clock;
  readonly config: ConfigStore;
  readonly env: NodeJS.ProcessEnv;
  readonly workspace: string;
  readonly root: string;
  readonly reporter: Reporter;
  readonly login: LoginDeps;
  readonly context: () => Promise<WorkspaceDeps>;
  readonly harness: HarnessSession;
  readonly skills: (agents: readonly string[] | undefined) => SkillDeps;
  readonly manifest: {
    readonly dir: string;
    readonly source: () => Promise<ManifestSource | undefined>;
    readonly update: ManifestUpdateCheck;
  };
  readonly self: {
    readonly packageName: string;
    readonly version: string;
    readonly registry: () => Promise<string | null>;
    readonly update: FxUpdateCheck;
  };
}

export type BackgroundPhases = Pick<
  AutomaticSyncDeps,
  'refresh' | 'docs' | 'skills' | 'self' | 'checks'
>;

export function backgroundPhases(deps: BackgroundDeps): BackgroundPhases {
  return {
    refresh: () => refreshManifest(deps),
    docs: (lease) => deriveDocs(deps, lease),
    skills: () => projectSkills(deps),
    self: () => checkSelf(deps),
    checks: () => checkServices(deps),
  };
}

async function refreshManifest(deps: BackgroundDeps): Promise<readonly HookObservation[]> {
  const observed = observer(deps, 'manifest');
  if (!(await updatesEnabled(deps))) return [observed('UPDATE_CHECK_DISABLED')];
  const source = await deps.manifest.source();
  if (source === undefined) return [observed('MANIFEST_REFRESH_UNAVAILABLE', 'fx sync')];
  if (source.kind !== 'repo') return [observed('MANIFEST_STATIC')];
  const { dir, update } = deps.manifest;
  const verdict = await update.execute({ workspace: deps.workspace, sourceDir: dir });
  if (verdict.source === 'skipped') return [observed('MANIFEST_REFRESH_UNAVAILABLE', 'fx sync')];
  if (verdict.error) return [observed('MANIFEST_UPSTREAM_UNAVAILABLE', 'fx sync')];
  if (!verdict.behind) return [observed('MANIFEST_UP_TO_DATE')];
  const result = await new RefreshManifest(deps.reporter).execute({
    manifestDir: dir,
    source,
    dryRun: false,
    posture: deps.login.trust.posture,
    settle: () => update.markCurrent(deps.workspace, dir),
  });
  return [observed(`MANIFEST_${result.result.toUpperCase()}`, 'fx sync')];
}

// The run already holds the workspace lease, so the rules projection is handed
// that lease instead of waiting for a lock it could never be given.
async function deriveDocs(deps: BackgroundDeps, lease: Lease): Promise<readonly HookObservation[]> {
  const observed = observer(deps, 'docs');
  const result = await new DeriveDocs(await deps.context(), deps.login).execute({
    check: false,
    dryRun: false,
    posture: deps.login.trust.posture,
  });
  const harness = await manageHarness({
    ...deps.harness,
    action: 'sync',
    dryRun: false,
    only: 'rules',
    workspaceLease: { workspace: deps.workspace, root: deps.root, lease },
  });
  const foreignRules = harness.items.some(
    (item) => item.action === 'foreign' || item.action === 'conflict',
  );
  return [
    ...(foreignRules ? [observed('RULES_FOREIGN', 'fx sync --only docs')] : []),
    observed(
      result.files.some((file) => file.action === 'foreign') ? 'DOCS_FOREIGN' : 'DOCS_CURRENT',
      'fx sync --only docs',
    ),
  ];
}

async function projectSkills(deps: BackgroundDeps): Promise<readonly HookObservation[]> {
  const observed = observer(deps, 'skills');
  const workspace = await deps.context();
  const settings = readSettings({ env: deps.env, file: await deps.config.read() });
  const result = await new SkillStage(workspace, deps.skills(settings.agents)).execute({
    dryRun: false,
    posture: deps.login.trust.posture,
    toolchain: toolchainOf(workspace.ctx).tools,
    trust: { ...deps.login.trust, workspace: deps.workspace },
    background: true,
  });
  const observations: HookObservation[] = [];
  if (result.tools.some((tool) => tool.note === 'untrusted'))
    observations.push(observed('VECTOR_UNTRUSTED', 'fx sync --only skills'));
  if (
    result.fx.some((copy) => copy.action === 'foreign') ||
    result.links.some((link) => link.action === 'foreign')
  )
    observations.push(observed('SKILL_FOREIGN', 'fx agent skills'));
  if (result.tools.some((tool) => tool.code !== null && tool.code !== 0))
    observations.push(observed('SKILL_SYNC_FAILED', 'fx sync --only skills'));
  return observations.length ? observations : [observed('SKILLS_CHECKED', 'fx agent skills')];
}

async function checkSelf(deps: BackgroundDeps): Promise<readonly HookObservation[]> {
  const observed = observer(deps, 'self');
  if (!(await updatesEnabled(deps))) return [observed('UPDATE_CHECK_DISABLED')];
  const verdict = await deps.self.update.execute({
    current: deps.self.version,
    packageName: deps.self.packageName,
    registry: await deps.self.registry(),
  });
  if (verdict.source === 'skipped') return [observed('FX_UPDATE_UNAVAILABLE', 'fx self info')];
  if (verdict.error) return [observed('FX_UPDATE_UNAVAILABLE', 'fx doctor')];
  return [observed(verdict.behind ? 'FX_OUTDATED' : 'FX_CHECKED', 'fx self info')];
}

async function checkServices(deps: BackgroundDeps): Promise<readonly HookObservation[]> {
  const findings = await checkLogin(await deps.context(), deps.login, {});
  return [
    observer(deps, 'checks')(
      findings.some((finding) => finding.level !== 'ok') ? 'LOGIN_REQUIRED' : 'LOGIN_CHECKED',
      'fx login --list',
    ),
  ];
}

async function updatesEnabled(deps: BackgroundDeps): Promise<boolean> {
  return readSettings({ env: deps.env, file: await deps.config.read() }).updateCheck;
}

function observer(
  deps: BackgroundDeps,
  phase: string,
): (code: string, command?: string) => HookObservation {
  return (code, command) => ({
    phase,
    code,
    command: command ?? null,
    checkedAt: deps.clock.now().getTime(),
  });
}
