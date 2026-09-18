// Automatic session services reuse the manifest, docs, Skill and verifier use
// cases. Wiring deliberately has no repository sync or platform query service.

import { readSettings } from '../application/config/settings.js';
import { DeriveDocs } from '../application/docs/derive.js';
import { checkLogin } from '../application/doctor/login.js';
import type { AutomaticSyncDeps } from '../application/hook/automatic-sync.js';
import type { LoginDeps } from '../application/login/deps.js';
import { RefreshManifest } from '../application/refresh-manifest.js';
import { TrustGate } from '../application/safety/trust.js';
import { SkillStage } from '../application/skill/stage.js';
import { toolchainOf } from '../application/tool/toolchain.js';
import type { WorkspaceDeps } from '../application/workspace/deps.js';
import { WorkspaceContext } from '../application/workspace-context.js';
import type { HookRequest } from '../domain/harness/request.js';
import type { HookObservation } from '../domain/harness/state.js';
import type { Lease } from '../ports/lock.js';
import type { Reporter } from '../ports/reporter.js';

import type { PackageMetadata } from './bundled.js';
import { skillDeps, workspaceDeps, type Container } from './container.js';
import { manageHarness } from './harness-stages.js';
import { hookDeps } from './hooks.js';
import { manifestSourceFor } from './manifest-sources.js';
import { configuredRegistry } from './registry-location.js';
import { updateChecks } from './update.js';

interface ServiceInput {
  readonly container: Container;
  readonly request: HookRequest;
  readonly env: NodeJS.ProcessEnv;
  readonly canWrite: () => Promise<boolean>;
}
interface Services extends ServiceInput {
  readonly reporter: Reporter;
  readonly login: LoginDeps;
  readonly metadata: PackageMetadata;
  readonly context: () => Promise<WorkspaceDeps>;
  readonly observation: (phase: string, code: string, command?: string) => HookObservation;
}

export async function createHookServices(input: ServiceInput): Promise<AutomaticSyncDeps> {
  const { container, request } = input;
  const reporter: Reporter = { notice: () => {}, progress: () => {} };
  const metadata = container.packageMetadata();
  const login = createLogin(container);
  let loaded: WorkspaceDeps | undefined;
  const services: Services = {
    ...input,
    reporter,
    metadata,
    login,
    observation: (phase, code, command) => ({
      phase,
      code,
      command: command ?? null,
      checkedAt: container.clock.now().getTime(),
    }),
    context: async () => {
      loaded ??= workspaceDeps(
        container,
        await WorkspaceContext.locate({
          cwd: request.root,
          name: request.workspace,
          config: container.config,
          fs: container.fs,
          git: container.git,
          localStore: container.localStore,
          reporter,
          bundledTools: container.bundledTools,
          cliVersion: metadata.version,
          manifestDirFor: container.manifestDirFor,
        }),
        reporter,
        metadata.version,
        undefined,
      );
      return loaded;
    },
  };
  return {
    clock: container.clock,
    state: hookDeps(container).state,
    lock: container.lock,
    canWrite: input.canWrite,
    refresh: () => refresh(services),
    docs: (lease) => docs(services, lease),
    skills: () => skills(services),
    self: () => self(services),
    checks: () => checks(services),
  };
}

async function updatesEnabled(s: Services): Promise<boolean> {
  return readSettings({ env: s.env, file: await s.container.config.read() }).updateCheck;
}

async function refresh(s: Services): Promise<readonly HookObservation[]> {
  const { container, request, observation } = s;
  if (!(await updatesEnabled(s))) return [observation('manifest', 'UPDATE_CHECK_DISABLED')];
  const sourceSpec = (await container.config.read()).workspaces?.[request.workspace]?.source;
  const source =
    sourceSpec === undefined
      ? undefined
      : await manifestSourceFor(sourceSpec, container, async () => '');
  if (source === undefined)
    return [observation('manifest', 'MANIFEST_REFRESH_UNAVAILABLE', 'fx sync')];
  if (source.kind !== 'repo') return [observation('manifest', 'MANIFEST_STATIC')];
  const manifestDir = container.manifestDirFor(request.workspace);
  const update = updateChecks(container).manifest;
  const verdict = await update.execute({ workspace: request.workspace, sourceDir: manifestDir });
  if (verdict.source === 'skipped')
    return [observation('manifest', 'MANIFEST_REFRESH_UNAVAILABLE', 'fx sync')];
  if (verdict.error) return [observation('manifest', 'MANIFEST_UPSTREAM_UNAVAILABLE', 'fx sync')];
  if (!verdict.behind) return [observation('manifest', 'MANIFEST_UP_TO_DATE')];
  const result = await new RefreshManifest(s.reporter).execute({
    manifestDir,
    source,
    dryRun: false,
    posture: s.login.trust.posture,
    settle: () => update.markCurrent(request.workspace, manifestDir),
  });
  return [observation('manifest', `MANIFEST_${result.result.toUpperCase()}`, 'fx sync')];
}

async function docs(s: Services, lease: Lease): Promise<readonly HookObservation[]> {
  const result = await new DeriveDocs(await s.context(), s.login).execute({
    check: false,
    dryRun: false,
    posture: s.login.trust.posture,
  });
  const harness = await manageHarness({
    container: s.container,
    resolve: {
      cwd: s.request.root,
      name: s.request.workspace,
      config: s.container.config,
      fs: s.container.fs,
      reporter: s.reporter,
      manifestDirFor: s.container.manifestDirFor,
    },
    env: s.env,
    cliVersion: s.metadata.version,
    noInput: true,
    yes: false,
    posture: s.login.trust.posture,
    action: 'sync',
    dryRun: false,
    only: 'rules',
    workspaceLease: { workspace: s.request.workspace, root: s.request.root, lease },
  });
  return [
    ...(harness.items.some((item) => item.action === 'foreign' || item.action === 'conflict')
      ? [s.observation('docs', 'RULES_FOREIGN', 'fx sync --only docs')]
      : []),
    s.observation(
      'docs',
      result.files.some((f) => f.action === 'foreign') ? 'DOCS_FOREIGN' : 'DOCS_CURRENT',
      'fx sync --only docs',
    ),
  ];
}

async function skills(s: Services): Promise<readonly HookObservation[]> {
  const deps = await s.context();
  const file = await s.container.config.read();
  const result = await new SkillStage(
    deps,
    skillDeps(s.container, readSettings({ env: s.env, file }).agents),
  ).execute({
    dryRun: false,
    posture: s.login.trust.posture,
    toolchain: toolchainOf(deps.ctx).tools,
    trust: { ...s.login.trust, workspace: s.request.workspace },
    background: true,
  });
  const observations: HookObservation[] = [];
  if (result.tools.some((t) => t.note === 'untrusted'))
    observations.push(s.observation('skills', 'VECTOR_UNTRUSTED', 'fx sync --only skills'));
  if (
    result.fx.some((f) => f.action === 'foreign') ||
    result.links.some((f) => f.action === 'foreign')
  )
    observations.push(s.observation('skills', 'SKILL_FOREIGN', 'fx agent skills'));
  if (result.tools.some((t) => t.code !== null && t.code !== 0))
    observations.push(s.observation('skills', 'SKILL_SYNC_FAILED', 'fx sync --only skills'));
  return observations.length
    ? observations
    : [s.observation('skills', 'SKILLS_CHECKED', 'fx agent skills')];
}

async function self(s: Services): Promise<readonly HookObservation[]> {
  if (!(await updatesEnabled(s))) return [s.observation('self', 'UPDATE_CHECK_DISABLED')];
  const verdict = await updateChecks(s.container).fx.execute({
    current: s.metadata.version,
    packageName: s.metadata.name,
    registry: configuredRegistry(s.env, s.metadata.name),
  });
  if (verdict.source === 'skipped')
    return [s.observation('self', 'FX_UPDATE_UNAVAILABLE', 'fx self info')];
  if (verdict.error) return [s.observation('self', 'FX_UPDATE_UNAVAILABLE', 'fx doctor')];
  return [s.observation('self', verdict.behind ? 'FX_OUTDATED' : 'FX_CHECKED', 'fx self info')];
}

async function checks(s: Services): Promise<readonly HookObservation[]> {
  const findings = await checkLogin(await s.context(), s.login, {});
  return [
    s.observation(
      'checks',
      findings.some((f) => f.level !== 'ok') ? 'LOGIN_REQUIRED' : 'LOGIN_CHECKED',
      'fx login --list',
    ),
  ];
}

function createLogin(container: Container): LoginDeps {
  return {
    describeProvider: container.describeProvider,
    prompter: container.prompter(true),
    clock: container.clock,
    home: container.userHome,
    trust: {
      gate: new TrustGate(container.trust, container.prompter(true), container.clock),
      yes: false,
      posture: { readOnly: false, source: 'default' },
    },
  };
}
