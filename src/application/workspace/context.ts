// Resolve a registry identity, shared declarations and personal layer before workspace use.

import path from 'node:path';

import type { ResolvedRepo, ResolvedWorkspace } from '../../domain/manifest/local.js';
import type { Binding, PlatformBinding, ProviderCatalog } from '../../domain/manifest/providers.js';
import { describeManifestRepo } from '../../domain/manifest/source-repo.js';
import type { LocalLayer } from '../../domain/manifest/types.js';
import type { FileReader } from '../../ports/fs.js';
import type { Git } from '../../ports/git.js';
import type { Reporter } from '../../ports/reporter.js';
import type { LocalLayerStore } from '../../ports/stores.js';
import { loadManifestContext, type ManifestContext } from '../manifest/context.js';
import type { ManifestBundle } from '../manifest/load.js';

import { assertWorkspacePrepared, contextualWorkspaceError } from './health.js';
import { resolveWorkspace, type Located, type ResolveInput } from './resolve.js';
import { validateWorkspaceLayer } from './validate-layer.js';

export interface LocateWorkspaceInput extends ResolveInput {
  readonly allowMissingRoot?: boolean;
  readonly git: Pick<Git, 'remoteHead'>;
  readonly localStore: LocalLayerStore;
  readonly bundledTools: () => string;
  readonly providers: ProviderCatalog;
  readonly cliVersion: string;
}

// What `preview` and `locate` resolve before a context exists.
interface WorkspaceContextInput {
  readonly root: string;
  readonly name: string;
  readonly context: ManifestContext;
  readonly local: LocalLayer;
  readonly workspace: ResolvedWorkspace;
  readonly selection: Located['selection'];
}

export class WorkspaceContext {
  readonly root: string;
  readonly name: string;
  readonly context: ManifestContext;
  readonly local: LocalLayer;
  readonly workspace: ResolvedWorkspace;
  readonly selection: Located['selection'];
  readonly manifest: ManifestBundle;
  readonly providers: ProviderCatalog;
  readonly bindings: readonly Binding[];
  readonly platforms: readonly PlatformBinding[];

  private constructor(input: WorkspaceContextInput) {
    this.root = input.root;
    this.name = input.name;
    this.context = input.context;
    this.local = input.local;
    this.workspace = input.workspace;
    this.selection = input.selection;
    this.manifest = input.context.bundle;
    this.providers = input.context.providers;
    this.bindings = input.context.bindings;
    this.platforms = input.context.platforms;
  }

  get manifestDir(): string {
    return this.context.dir;
  }

  static async preview(
    root: string,
    name: string,
    context: ManifestContext,
    local: LocalLayer,
    fs: FileReader,
  ): Promise<WorkspaceContext> {
    const workspace = await validateWorkspaceLayer(
      fs,
      root,
      context.bundle.workspace.result.doc,
      local,
    );
    return new WorkspaceContext({ root, name, context, local, workspace, selection: 'explicit' });
  }

  static async locate(input: LocateWorkspaceInput): Promise<WorkspaceContext> {
    const located = await resolveWorkspace(input);
    await assertWorkspacePrepared(input, located, input.allowMissingRoot);
    const context = await loadManifestContext({ ...input, dir: located.manifestDir }).catch(
      (error: unknown) => {
        throw contextualWorkspaceError(input, located, error);
      },
    );
    const local = await input.localStore.read(located.name);
    const workspace = await validateWorkspaceLayer(
      input.fs,
      located.root,
      context.bundle.workspace.result.doc,
      local,
      await manifestRepoOf(input, located),
    );
    reportUnmatched(input.reporter, workspace);
    return new WorkspaceContext({
      root: located.root,
      name: located.name,
      context,
      local,
      workspace,
      selection: located.selection,
    });
  }
}

// The manifest checkout is a repository of the workspace when the source is
// one; an entry of the same name in the manifest wins.
async function manifestRepoOf(
  input: LocateWorkspaceInput,
  located: Located,
): Promise<ResolvedRepo | undefined> {
  const source = (await input.config.read()).workspaces?.[located.name]?.source;
  if (source === undefined) return undefined;
  if (!(await input.fs.exists(path.join(located.manifestDir, '.git')))) return undefined;
  const branch = (await input.git.remoteHead(located.manifestDir, 'upstream')) ?? 'main';
  return describeManifestRepo(source, located.manifestDir, branch);
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
