// The entry point of every workspace command: which workspace, its manifest
// (loaded from the source directory under ~/.fx), this machine's personal
// layer, and the two resolved together. Anything worth knowing about how
// the workspace was chosen or degraded is a notice here, emitted on every
// run rather than remembered.

import path from 'node:path';

import { DevkitError } from '../domain/errors.js';
import { applyLocal, type ResolvedRepo, type ResolvedWorkspace } from '../domain/manifest/local.js';
import type { Binding, PlatformBinding } from '../domain/manifest/providers.js';
import { describeManifestRepo } from '../domain/manifest/source-repo.js';
import type { LocalLayer } from '../domain/manifest/types.js';
import { isAtOrInside, windowsPathProblem } from '../domain/path.js';
import type { Git } from '../ports/git.js';
import type { Reporter } from '../ports/reporter.js';
import type { LocalLayerStore } from '../ports/stores.js';

import { loadManifestContext, type ManifestContext } from './manifest/context.js';
import type { ManifestBundle } from './manifest/load.js';
import { assertWorkspacePrepared, contextualWorkspaceError } from './workspace/health.js';
import { resolveWorkspace, type Located, type ResolveInput } from './workspace/resolve.js';

export interface LocateInput extends ResolveInput {
  readonly allowMissingRoot?: boolean;
  readonly git: Pick<Git, 'remoteHead'>;
  readonly localStore: LocalLayerStore;
  readonly bundledTools: () => string;
  readonly cliVersion: string;
}

export class WorkspaceContext {
  readonly manifest: ManifestBundle;
  readonly bindings: readonly Binding[];
  readonly platforms: readonly PlatformBinding[];

  private constructor(
    readonly root: string,
    readonly name: string,
    readonly context: ManifestContext,
    readonly local: LocalLayer,
    readonly workspace: ResolvedWorkspace,
    readonly selection: Located['selection'],
  ) {
    this.manifest = context.bundle;
    this.bindings = context.bindings;
    this.platforms = context.platforms;
  }

  get manifestDir(): string {
    return this.context.dir;
  }

  static async locate(input: LocateInput): Promise<WorkspaceContext> {
    const located = await resolveWorkspace(input);
    await assertWorkspacePrepared(input, located, input.allowMissingRoot);
    const context = await loadManifestContext({ ...input, dir: located.manifestDir }).catch(
      (error: unknown) => {
        throw contextualWorkspaceError(input, located, error);
      },
    );
    const local = await input.localStore.read(located.name);
    const workspace = withManifestRepo(
      applyLocal(context.bundle.workspace.result.doc, local),
      await manifestRepoOf(input, located),
    );
    refusePathAliases(located.root, workspace.repos);
    reportUnmatched(input.reporter, workspace);
    return new WorkspaceContext(
      located.root,
      located.name,
      context,
      local,
      workspace,
      located.selection,
    );
  }
}

// The manifest checkout is a repository of the workspace when the source is
// one; an entry of the same name in the manifest wins.
async function manifestRepoOf(
  input: LocateInput,
  located: Located,
): Promise<ResolvedRepo | undefined> {
  const source = (await input.config.read()).workspaces?.[located.name]?.source;
  if (source === undefined) return undefined;
  if (!(await input.fs.exists(path.join(located.manifestDir, '.git')))) return undefined;
  const branch = (await input.git.remoteHead(located.manifestDir, 'upstream')) ?? 'main';
  return describeManifestRepo(source, located.manifestDir, branch);
}

function withManifestRepo(
  workspace: ResolvedWorkspace,
  manifest: ResolvedRepo | undefined,
): ResolvedWorkspace {
  if (manifest === undefined || workspace.repos.some((r) => r.name === manifest.name))
    return workspace;
  return { ...workspace, repos: [...workspace.repos, manifest] };
}

// Native resolution catches absolute aliases, root ancestors and nesting
// that the platform-neutral manifest comparison cannot see.
function refusePathAliases(root: string, repos: ResolvedWorkspace['repos']): void {
  const owners: { readonly path: string; readonly name: string }[] = [];
  for (const repo of repos) {
    const resolved = path.resolve(root, repo.path);
    const problem = path.sep === '\\' ? windowsPathProblem(resolved) : undefined;
    if (problem) throw new DevkitError('config', 'LOCAL_INVALID', problem);
    const containsRoot = isAtOrInside(root, resolved);
    if (repo.origin !== 'manifest' && containsRoot) {
      throw new DevkitError(
        'config',
        'LOCAL_INVALID',
        `${repo.name} would make the workspace root part of its checkout: ${resolved}`,
        {
          hint: 'The workspace root must remain a plain directory outside every checkout.',
          nextSteps: ['fx repo list', 'fx self info'],
        },
      );
    }
    const owner = owners.find(
      (item) => isAtOrInside(resolved, item.path) || isAtOrInside(item.path, resolved),
    );
    if (owner !== undefined) {
      throw new DevkitError(
        'config',
        'LOCAL_INVALID',
        `${repo.name} and ${owner.name} resolve to overlapping checkouts: ${resolved}`,
        {
          hint: 'local.yaml may only add repositories at paths nothing else uses.',
          nextSteps: ['fx repo list', 'fx self info'],
        },
      );
    }
    owners.push({ path: resolved, name: repo.name });
  }
}

function reportUnmatched(reporter: Reporter, workspace: ResolvedWorkspace): void {
  if (workspace.unmatched.length === 0) return;
  reporter.notice({
    code: 'LOCAL_OVERRIDE_UNMATCHED',
    message: `the personal layer names repositories the manifest does not have: ${workspace.unmatched.join(', ')}`,
    nextSteps: ['fx repo list', 'fx self info'],
    data: { unmatched: workspace.unmatched },
  });
}
