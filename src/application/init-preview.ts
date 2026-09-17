// Inspect initialization without registration, source materialization, provider commands or global resource writes.
import path from 'node:path';

import { DevkitError } from '../domain/errors.js';
import { bindPlatforms, bindProviders } from '../domain/manifest/providers.js';
import type { LocalLayer } from '../domain/manifest/types.js';
import type { ManifestSourceInspection } from '../ports/manifest-source.js';
import type { ConfigFile } from '../ports/stores.js';

import type { InitDeps, InitInput, InitOutput } from './init.js';
import { LoadManifest, type ManifestBundle } from './manifest/load.js';
import { toolsOf } from './tool/toolchain.js';
import { planRepositories } from './workspace/plan.js';
import { scopeMode } from './workspace/scope.js';
import { WorkspaceContext } from './workspace-context.js';

export async function initialLocalLayer(
  deps: InitDeps,
  name: string,
  bundle: ManifestBundle,
  repos: readonly string[] | undefined,
): Promise<LocalLayer> {
  const local = await deps.localStore.read(name);
  if (repos === undefined) return local;
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
  return { ...local, scope: { ...local.scope, repos: [...new Set(repos)] } };
}

export async function inspectInitialization(
  deps: InitDeps,
  input: InitInput,
  output: InitOutput,
  inspection: ManifestSourceInspection | undefined,
): Promise<InitOutput['plan']> {
  const plan = output.plan;
  if (inspection === undefined) return plan;
  const bundle = await new LoadManifest(
    {
      readText: (file) =>
        inspection.readText(path.relative(output.manifest_dir, file).split(path.sep).join('/')),
    },
    deps.bundledTools,
  ).execute({ dir: output.manifest_dir, cliVersion: deps.cliVersion });
  const local = await initialLocalLayer(deps, output.name, bundle, input.repos);
  const context = {
    dir: output.manifest_dir,
    bundle,
    bindings: bindProviders(bundle.workspace.result.doc),
    platforms: bindPlatforms(bundle.environments?.result.doc),
  };
  const ctx = WorkspaceContext.preview(output.root, output.name, context, local);
  const repositories = await planRepositories(deps.workspaceDepsFor(ctx), {
    jobs: input.jobs,
    remote: false,
  });
  const tools = toolsOf(bundle);
  return {
    ...plan,
    source_inspected: true,
    selection: {
      mode: scopeMode(local.scope?.repos),
      repos: local.scope?.repos ?? null,
      validated: true,
    },
    repositories,
    resources: {
      ...plan.resources,
      tools: tools
        .filter((tool) => tool.enabled && tool.installOnInit)
        .map((tool) => ({
          name: tool.name,
          action: 'install_if_missing',
          scope: 'global',
          methods: tool.install,
        })),
      companion_skills: tools
        .filter((tool) => tool.enabled && tool.skill !== undefined)
        .map((tool) => tool.name),
      mcp: bundle.harness?.result.doc.mcp.map((resource) => resource.name) ?? [],
    },
    unchecked: [
      'Remote repository access, branch availability and incoming commits are not queried; repository actions are based on local state.',
      'Tool installation status, agent selection, service settings, and ownership/conflicts of generated resources are checked during preparation. No command trust is granted by this preview.',
    ],
  };
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
  return {
    source_inspected: false,
    manifest_action: refreshed ? 'refresh' : 'materialize',
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
      'Source contents have not been acquired. Repository names, selection and resource declarations are unverified. Inspect a local checkout with --from <directory> --dry-run, or initialize to acquire and validate the remote source before repository cloning.',
    ],
  };
}
