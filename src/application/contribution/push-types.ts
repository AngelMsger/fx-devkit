// Public plans carry reviewable names and results, not captured file bodies.
// Private planning state retains the evidence needed for locked revalidation.

import type { ContributionOperation } from '../../domain/contribution/operation.js';
import type { ContributionPullRequest } from '../../domain/contribution/pull-request.js';
import type {
  ContributionRemoteSettings,
  VerifiedContributionRemote,
} from '../../domain/contribution/remote.js';
import type { RepoRef } from '../../domain/workspace/ref.js';
import type { Clock } from '../../ports/clock.js';
import type { CodeHost } from '../../ports/code-host.js';
import type { ContributionGit, ContributionSnapshot } from '../../ports/contribution-git.js';
import type { ContributionStore } from '../../ports/contribution-store.js';
import type {
  ContributionTransport,
  ContributionUpstream,
} from '../../ports/contribution-transport.js';
import type { FileSystem } from '../../ports/fs.js';
import type { Identifiers } from '../../ports/identifiers.js';
import type { Lock } from '../../ports/lock.js';
import type { Prompter } from '../../ports/prompter.js';
import type { ConfigStore, WorkspaceEntry } from '../../ports/stores.js';
import type { WritePosture } from '../safety/posture.js';

import type { ContributionFinding, ValidateContribution } from './validate.js';

export interface PushSourceInput {
  readonly paths: readonly string[];
  readonly issue: string;
  readonly title: string;
  readonly message?: string;
  readonly prRef?: string;
  readonly cliVersion: string;
  readonly dryRun: boolean;
  readonly yes: boolean;
  readonly forceNew: boolean;
  readonly posture: WritePosture;
}

export type ContributionHost = Pick<
  CodeHost,
  'supportsContributions' | 'whoami' | 'repositoryIdentity' | 'pullRequest' | 'createPullRequest'
>;

export interface PushSourceDeps {
  readonly registration: {
    readonly expected: WorkspaceEntry;
    readonly config: ConfigStore;
    readonly fs: FileSystem;
  };
  readonly user?: string | undefined;
  readonly source: {
    readonly workspace: string;
    readonly dir: string;
    readonly kind: 'repo' | 'file' | 'stdin';
  };
  readonly git: ContributionGit;
  readonly transport: ContributionTransport;
  readonly records: ContributionStore;
  readonly hostFor: (baseFiles: Readonly<Record<string, string>>) => ContributionHost;
  readonly validator: Pick<ValidateContribution, 'execute'>;
  readonly ids: Identifiers;
  readonly clock: Clock;
  readonly lock: Lock;
  readonly prompter: Prompter;
}

export interface PushSourceOutput {
  readonly workspace: string;
  readonly action:
    | 'create'
    | 'update'
    | 'unchanged'
    | 'resume'
    | 'associate'
    | 'recover'
    | 'needs-fetch'
    | 'cancelled';
  readonly files: readonly string[];
  readonly branch: string;
  readonly base: string;
  readonly tree: string | null;
  readonly commit: string | null;
  readonly source: RepoRef;
  readonly target: RepoRef;
  readonly target_branch: string;
  readonly message: string | null;
  readonly title: string | null;
  readonly pull_request: ContributionPullRequest | null;
  readonly findings: readonly ContributionFinding[];
  readonly validated: boolean;
  readonly written: boolean;
  readonly fetched: boolean;
  readonly retired: readonly string[];
}

export interface SourcePlan {
  readonly output: PushSourceOutput;
  readonly allocatedId: string;
  readonly records: readonly ContributionOperation[];
  readonly operation: ContributionOperation | null;
  readonly snapshot: ContributionSnapshot | null;
  readonly remote: VerifiedContributionRemote | null;
  readonly identity: string;
  readonly settings: ContributionRemoteSettings;
  readonly upstream: ContributionUpstream;
  readonly host: ContributionHost | null;
  readonly key: string;
}
