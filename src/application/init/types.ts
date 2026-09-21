// What initialization is asked for, what it plans, and what it reports about
// every phase it reached.

import type { ProviderCatalog } from '../../domain/manifest/providers.js';
import type { Preparation } from '../../domain/preparation.js';
import type { SetupPlan } from '../../domain/setup/types.js';
import type { ResolvedShell } from '../../domain/shell.js';
import type { PlanItem } from '../../domain/workspace/plan.js';
import type { FileSystem } from '../../ports/fs.js';
import type { Git } from '../../ports/git.js';
import type { Lock } from '../../ports/lock.js';
import type { ManifestSource } from '../../ports/manifest-source.js';
import type { Reporter } from '../../ports/reporter.js';
import type { ConfigStore, LocalLayerStore } from '../../ports/stores.js';
import type { WritePosture } from '../safety/posture.js';
import type { SyncOutput, SyncStages } from '../sync/types.js';
import type { ToolInstallOutput } from '../tool/install.js';
import type { WorkspaceDeps } from '../workspace/deps.js';
import type { ScopeMode } from '../workspace/scope.js';
import type { WorkspaceContext } from '../workspace-context.js';

export interface InitDeps {
  readonly setupPlan?: (ctx: WorkspaceContext) => Promise<SetupPlan>;
  readonly lock: Lock;
  readonly commandShell?: ResolvedShell | undefined;
  readonly fs: FileSystem;
  readonly git: Git;
  readonly config: ConfigStore;
  readonly localStore: LocalLayerStore;
  readonly bundledTools: () => string;
  readonly providers: ProviderCatalog;
  readonly cliVersion: string;
  readonly reporter: Reporter;
  readonly manifestDirFor: (name: string) => string;
  readonly workspaceDepsFor: (ctx: WorkspaceContext) => WorkspaceDeps;
  readonly preview?: (ctx: WorkspaceContext) => Promise<object>;
  readonly installTools?: (ctx: WorkspaceContext) => Promise<readonly ToolInstallOutput[]>;
  readonly stagesFor: (ctx: WorkspaceContext) => SyncStages;
  readonly settleManifest: (name: string, manifestDir: string) => Promise<void>;
}

export interface InitInput {
  readonly resume?: boolean;
  readonly dir: string;
  readonly source: ManifestSource;
  readonly name?: string | undefined;
  readonly repos?: readonly string[] | undefined;
  readonly adopt: boolean;
  readonly dryRun: boolean;
  readonly posture: WritePosture;
  readonly jobs: number;
}

export interface InitOutput {
  readonly operation: 'preview' | 'apply';
  readonly preparation: Preparation;
  readonly root: string;
  readonly name: string;
  readonly source: string;
  readonly manifest_dir: string;
  readonly manifest: 'materialized' | 'refreshed' | 'not_written' | 'kept';
  readonly adopted: boolean;
  readonly registered: boolean;
  readonly default_workspace: boolean;
  readonly sync: Omit<SyncOutput, 'preparation'> | null;
  readonly tool_install: readonly ToolInstallOutput[] | null;
  readonly written: boolean;
  readonly prepared?: object | null;
  readonly plan: {
    readonly source_inspected: boolean;
    readonly inspected_source: string | null;
    readonly manifest_action: 'materialize' | 'refresh' | 'keep';
    readonly registration: 'register' | 'keep';
    readonly default_workspace: 'set' | 'keep';
    readonly selection: {
      readonly mode: ScopeMode;
      readonly repos: readonly string[] | null;
      readonly validated: boolean;
    };
    readonly repositories: readonly PlanItem[] | null;
    readonly resources: Readonly<Record<string, unknown>>;
    readonly unchecked: readonly string[];
  };
}
