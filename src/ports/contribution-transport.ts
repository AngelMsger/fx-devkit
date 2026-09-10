// Source transport accepts an already verified personal-fork identity, then
// rechecks local routing before asking or pushing one managed branch.

import type {
  ContributionRemoteSettings,
  VerifiedContributionRemote,
} from '../domain/contribution/remote.js';

export interface SourceDirectory {
  readonly dir: string;
}
export interface ContributionRemoteBranch extends SourceDirectory {
  readonly remote: VerifiedContributionRemote;
  readonly branch: string;
}
export interface ContributionPush extends ContributionRemoteBranch {
  readonly commit: string;
}

export interface ContributionTransport {
  inspect(input: SourceDirectory): Promise<ContributionRemoteSettings>;
  upstream(input: SourceDirectory): Promise<ContributionUpstream>;
  fetch(input: FetchContributionBase): Promise<void>;
  head(input: ContributionRemoteBranch): Promise<string | null>;
  push(input: ContributionPush): Promise<void>;
}

export interface ContributionUpstream {
  readonly sha: string;
  readonly branch: string;
}

export interface FetchContributionBase extends SourceDirectory {
  readonly settings: ContributionRemoteSettings;
  readonly branch: string;
}
