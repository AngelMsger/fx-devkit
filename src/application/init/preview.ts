// Inspect source, selection and authorized preparation plans without registering or materializing a workspace.
import path from 'node:path';

import { DERIVED_GUIDE, isDerived } from '../../domain/docs/derived.js';
import { completeRegions, type RenderedRegions } from '../../domain/docs/regions.js';
import { REGIONS } from '../../domain/docs/templates.js';
import { DevkitError } from '../../domain/errors.js';
import { bindPlatforms, bindProviders } from '../../domain/manifest/providers.js';
import type { LocalLayer } from '../../domain/manifest/types.js';
import { isLocalPreparation, type SetupPlan } from '../../domain/setup/types.js';
import { installsOnInit } from '../../domain/toolchain/resolve.js';
import type { ManifestSourceInspection } from '../../ports/manifest-source.js';
import type { ProjectionStore } from '../../ports/projection.js';
import type { ConfigFile } from '../../ports/stores.js';
import { documentPath } from '../docs/rendered.js';
import { Login } from '../login/run.js';
import { LoadManifest, type ManifestBundle } from '../manifest/load.js';
import { requireUsableManifest } from '../manifest/prepare.js';
import { SkillStage } from '../skill/stage.js';
import { Tally } from '../tally.js';
import { workspaceToolScope } from '../tool/scope.js';
import { toolchainOf } from '../tool/toolchain.js';
import { WorkspaceContext } from '../workspace/context.js';
import type { WorkspaceDeps } from '../workspace/deps.js';
import { planRepositories } from '../workspace/plan.js';
import { scopeMode } from '../workspace/scope.js';
import { validateWorkspaceLayer } from '../workspace/validate-layer.js';

import { initializationSourceError } from './errors.js';
import { PreviewInitialization, type InitializationPreview } from './preview-initialization.js';
import type { InitDeps, InitInput, InitOutput } from './types.js';

export async function initialLocalLayer(
  deps: InitDeps,
  name: string,
  root: string,
  bundle: ManifestBundle,
  repos: readonly string[] | undefined,
  current?: LocalLayer,
): Promise<LocalLayer> {
  const local = current ?? (await deps.localStore.read(name));
  if (repos === undefined) {
    await validateWorkspaceLayer(deps.fs, root, bundle.workspace.result.doc, local);
    return local;
  }
  const known = bundle.workspace.result.doc.repos.map((repo) => repo.name);
  const unknown = repos.filter((repo) => !known.includes(repo));
  if (unknown.length > 0)
    throw new DevkitError(
      'not_found',
      'REPO_NOT_FOUND',
      `Unknown shared repositories: ${unknown.join(', ')}`,
      {
        nextSteps: [
          'Preview the source with fx init <dir> --from <source> --dry-run to list repository names.',
        ],
      },
    );
  const next = { ...local, scope: { ...local.scope, repos: [...new Set(repos)] } };
  await validateWorkspaceLayer(deps.fs, root, bundle.workspace.result.doc, next);
  return next;
}

export async function inspectInitialization(
  deps: InitDeps,
  input: InitInput,
  output: InitOutput,
  inspection: ManifestSourceInspection | undefined,
): Promise<InitOutput['plan']> {
  if (inspection === undefined) return output.plan;
  const bundle = await loadInspectedSource(deps, input, output, inspection);
  requireUsableManifest(bundle);
  const local = await initialLocalLayer(deps, output.name, output.root, bundle, input.repos);
  const context = {
    dir: output.manifest_dir,
    bundle,
    providers: deps.providers,
    bindings: bindProviders(bundle.workspace.result.doc, deps.providers),
    platforms: bindPlatforms(bundle.environments?.result.doc, deps.providers),
  };
  const ctx = await WorkspaceContext.preview(output.root, output.name, context, local, deps.fs);
  const workspaceDeps = deps.workspaceDepsFor(ctx);
  const { guidePlan, guideConflicts } = await inspectGuides(
    output.root,
    inspection,
    workspaceDeps.projections,
  );
  const setup = await checkedSetupPlan(deps, workspaceDeps);
  const repos = ctx.workspace.repos.length;
  const repositories = await Tally.during(workspaceDeps.activity, 'repos', (tally) =>
    planRepositories(workspaceDeps, { jobs: input.jobs, remote: false, tally: tally.plan(repos) }),
  );
  return {
    ...output.plan,
    source_inspected: true,
    inspected_source: inspection.root,
    selection: {
      mode: scopeMode(local.scope?.repos),
      repos: local.scope?.repos ?? null,
      validated: true,
    },
    repositories,
    resources: await inspectedResources({
      deps,
      input,
      output,
      workspace: workspaceDeps,
      guidePlan,
      guideConflicts,
      setup,
    }),
    unchecked: [
      'Remote repository access, branch availability and incoming commits are not queried; repository actions are based on local state.',
      'Tool installation status, agent selection, service settings, and ownership/conflicts of generated resources are checked during preparation. No command trust is granted by this preview.',
    ],
  };
}

// The preparation an initialized workspace would run, planned without granting trust.
export function previewPreparation(
  deps: InitDeps,
  workspace: WorkspaceDeps,
): Promise<InitializationPreview> {
  const { login, skills } = deps.stages;
  return new PreviewInitialization(workspace, {
    login,
    install: deps.toolInstall,
    skills: new SkillStage(workspace, skills),
  }).execute();
}

async function checkedSetupPlan(deps: InitDeps, workspace: WorkspaceDeps): Promise<SetupPlan> {
  const toolScope = workspaceToolScope(workspace.ctx, {});
  if (toolScope.problems.length)
    throw new DevkitError(
      'config',
      'SETUP_PLAN_INVALID',
      'The selected workspace capabilities cannot be prepared',
      {
        hint: toolScope.problems.map((problem) => problem.message).join('\n'),
        nextSteps: ['Correct the named provider or tool declarations in the source, then retry.'],
      },
    );
  const setup = await new Login(workspace, deps.stages.login).plan({
    tools: toolScope.configuredNames,
  });
  if (setup.problems.length > 0)
    throw new DevkitError('config', 'SETUP_PLAN_INVALID', 'The declared setup cannot be prepared', {
      hint: setup.problems.map((problem) => `${problem.step}: ${problem.detail}`).join('\n'),
      nextSteps: ['Correct the listed setup definitions in the source, then retry initialization.'],
      partialResult: { problems: setup.problems },
    });
  return setup;
}

async function inspectGuides(
  root: string,
  inspection: ManifestSourceInspection,
  projections: ProjectionStore,
): Promise<{ guidePlan: RenderedRegions; guideConflicts: string[] }> {
  const guide = await inspection.readText('AGENTS.md');
  const guidePlan = completeRegions(
    guide ?? '',
    Object.fromEntries(REGIONS.map((name) => [name, ''])),
  );
  const target = path.join(root, DERIVED_GUIDE);
  const snapshot = await projections.read(documentPath(target));
  const foreign =
    snapshot.kind === 'foreign' || (snapshot.text !== null && !isDerived(snapshot.text));
  return { guidePlan, guideConflicts: foreign ? [target] : [] };
}

async function inspectedResources({
  deps,
  input,
  output,
  workspace,
  guidePlan,
  guideConflicts,
  setup,
}: {
  deps: InitDeps;
  input: InitInput;
  output: InitOutput;
  workspace: WorkspaceDeps;
  guidePlan: RenderedRegions;
  guideConflicts: readonly string[];
  setup: SetupPlan;
}): Promise<InitOutput['plan']['resources']> {
  const { ctx } = workspace;
  const tools = toolchainOf(ctx).tools;
  return {
    ...output.plan.resources,
    guide_regions_to_add: guidePlan.added ?? [],
    guide_conflicts: guideConflicts.map((file) => ({
      path: file,
      action: 'requires_replacement_approval',
      backup: 'The original is preserved in a unique sibling backup before replacement',
    })),
    preparation: input.dryRun ? await previewPreparation(deps, workspace) : null,
    setup: setup.steps.map((step) => ({
      id: step.id,
      tool: step.tool,
      phase: step.phase ?? 'manual',
      title: step.title,
      action: isLocalPreparation(step) ? 'prepare_if_needed' : 'verify_only',
      command: isLocalPreparation(step) ? (step.run ?? null) : null,
      cwd: ctx.root,
      verify: step.verify,
      requires: step.requires,
    })),
    tools: tools.filter(installsOnInit).map((tool) => ({
      name: tool.name,
      action: 'install_if_missing',
      scope: 'global',
      methods: tool.install,
    })),
    companion_skills: tools
      .filter((tool) => tool.enabled && (tool.skill?.command.length ?? 0) > 0)
      .map((tool) => tool.name),
    tool_checks: workspaceToolScope(ctx, {})
      .covered.filter((tool) => tool.enabled)
      .map((tool) => ({ name: tool.name, command: [tool.binary, ...tool.versionArgs] })),
    mcp: ctx.manifest.harness?.result.doc.mcp.map((resource) => resource.name) ?? [],
  };
}

async function loadInspectedSource(
  deps: InitDeps,
  input: InitInput,
  output: InitOutput,
  inspection: ManifestSourceInspection,
): Promise<ManifestBundle> {
  return new LoadManifest({
    fs: {
      readText: (file) =>
        inspection.readText(path.relative(output.manifest_dir, file).split(path.sep).join('/')),
    },
    bundledTools: deps.bundledTools,
  })
    .execute({ dir: output.manifest_dir, cliVersion: deps.cliVersion, providers: deps.providers })
    .catch((error: unknown) => {
      throw initializationSourceError(deps, input, output, inspection, error);
    });
}

interface InitialPlanFacts {
  readonly name: string;
  readonly root: string;
  readonly manifestDir: string;
  readonly refreshed: boolean;
  readonly config: ConfigFile;
  readonly local: LocalLayer;
}

export function initialPlan(
  deps: InitDeps,
  input: InitInput,
  facts: InitialPlanFacts,
): InitOutput['plan'] {
  const { name, root, manifestDir, refreshed, config, local } = facts;
  const selection = input.repos ?? local.scope?.repos;
  let manifestAction: InitOutput['plan']['manifest_action'] = refreshed ? 'refresh' : 'materialize';
  if (input.source.kind === 'kept') manifestAction = 'keep';
  return {
    source_inspected: false,
    inspected_source: null,
    manifest_action: manifestAction,
    registration: config.workspaces?.[name] === undefined ? 'register' : 'keep',
    default_workspace: config.default_workspace === undefined ? 'set' : 'keep',
    selection: { mode: scopeMode(selection), repos: selection ?? null, validated: false },
    repositories: null,
    resources: {
      manifest: manifestDir,
      registration: deps.config.path(),
      personal_selection: input.repos === undefined ? null : deps.localStore.path(name),
      workspace_guides: root,
      agent_resources:
        'Selected hosts may receive Skills, rules, MCP settings and lifecycle hooks; existing foreign content is preserved.',
      services:
        'Declared public companion settings may be prepared through trusted commands; credentials remain personal.',
      global_tools:
        'Missing enabled tools explicitly marked install_on_init may be installed globally after trust approval.',
    },
    unchecked: [
      'Effective source contents for this invocation have not been determined. Repository names, selection and resource declarations are unverified. A refresh may preserve the current managed checkout. Inspect a local checkout with --from <directory> --dry-run, or initialize to acquire and validate the remote source before repository cloning.',
    ],
  };
}
