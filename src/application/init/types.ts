// What initialization is asked for, what it plans, and what it reports about
// every phase it reached.

import type { ProviderCatalog } from '../../domain/manifest/providers.js';
import type { Preparation } from '../../domain/preparation.js';
import type { SetupStep, StepPhase } from '../../domain/setup/types.js';
import type { ResolvedShell } from '../../domain/shell.js';
import type { ResolvedTool } from '../../domain/toolchain/resolve.js';
import type { PlanItem } from '../../domain/workspace/plan.js';
import type { FileSystem } from '../../ports/fs.js';
import type { Git } from '../../ports/git.js';
import type { Lock } from '../../ports/lock.js';
import type { Reporter } from '../../ports/reporter.js';
import type { ConfigStore, LocalLayerStore } from '../../ports/stores.js';
import type { WritePosture } from '../safety/posture.js';
import type { SyncStageDeps } from '../sync/stages.js';
import type { SyncOutput } from '../sync/types.js';
import type { ToolInstall, ToolInstallOutput } from '../tool/install.js';
import type { WorkspaceContext } from '../workspace/context.js';
import type { WorkspaceDeps } from '../workspace/deps.js';
import type { ScopeMode } from '../workspace/scope.js';

import type { InitializationPreview } from './preview-initialization.js';
import type { InitSource } from './source.js';

export interface InitDeps {
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
  readonly toolInstall: ToolInstall;
  // What the stages of the first sync need; setup planning and the preparation
  // preview read the same login and Skill bundles.
  readonly stages: SyncStageDeps;
  readonly settleManifest: (name: string, manifestDir: string) => Promise<void>;
}

export interface InitInput {
  readonly dir: string;
  readonly source: InitSource;
  readonly name?: string | undefined;
  readonly repos?: readonly string[] | undefined;
  readonly adopt: boolean;
  readonly dryRun: boolean;
  readonly posture: WritePosture;
  readonly jobs: number;
}

export interface PlannedSetupStep {
  readonly id: string;
  readonly tool: string;
  readonly phase: StepPhase | 'manual';
  readonly title: string;
  readonly action: 'prepare_if_needed' | 'verify_only';
  readonly command: readonly string[] | null;
  readonly cwd: string;
  readonly verify: SetupStep['verify'];
  readonly requires: SetupStep['requires'];
}

// Where initialization writes and what it may prepare. Everything after the standing
// descriptions is known once the source has been inspected.
export interface InitResources {
  readonly manifest: string;
  readonly registration: string;
  readonly personal_selection: string | null;
  readonly workspace_guides: string;
  readonly agent_resources: string;
  readonly services: string;
  readonly global_tools: string;
  readonly guide_regions_to_add?: readonly string[];
  readonly guide_conflicts?: readonly {
    readonly path: string;
    readonly action: 'requires_replacement_approval';
    readonly backup: string;
  }[];
  // Planned for a preview only; an applied initialization reports it as `prepared`.
  readonly preparation?: InitializationPreview | null;
  readonly setup?: readonly PlannedSetupStep[];
  readonly tools?: readonly {
    readonly name: string;
    readonly action: 'install_if_missing';
    readonly scope: 'global';
    readonly methods: ResolvedTool['install'];
  }[];
  readonly companion_skills?: readonly string[];
  readonly tool_checks?: readonly { readonly name: string; readonly command: readonly string[] }[];
  readonly mcp?: readonly string[];
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
  readonly prepared?: InitializationPreview | null;
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
    readonly resources: InitResources;
    readonly unchecked: readonly string[];
  };
}
