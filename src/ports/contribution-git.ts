// Contribution Git has a private-index write surface, separate from sync. It
// constructs a named branch without checkout, merge or changes to the real index.

import type { ContributionFile } from '../domain/contribution/snapshot.js';

export interface CaptureContribution {
  readonly dir: string;
  readonly base: string;
  readonly paths: readonly string[];
}

export interface ContributionSnapshot {
  readonly dir: string;
  readonly base: string;
  readonly head: string;
  readonly paths: readonly string[];
  readonly files: readonly ContributionFile[];
  readonly baseFiles: Readonly<Record<string, string>>;
  readonly fingerprint: string;
  readonly tree: string;
}

export interface ConstructContribution {
  readonly snapshot: ContributionSnapshot;
  readonly branch: string;
  readonly parent: string;
  readonly expectedHead: string | null;
  readonly message: string;
}

export interface ConstructedContribution {
  readonly commit: string;
  readonly tree: string;
}

export interface ContributionGit {
  capture(input: CaptureContribution): Promise<ContributionSnapshot>;
  prepare(input: ConstructContribution): Promise<ConstructedContribution>;
  publish(input: PublishContribution): Promise<void>;
  inspect(input: InspectContribution): Promise<ContributionCommit | null>;
  readBase(input: InspectContribution): Promise<Readonly<Record<string, string>>>;
}

export interface InspectContribution {
  readonly dir: string;
  readonly ref: string;
}

export interface ContributionCommit {
  readonly sha: string;
  readonly tree: string;
  readonly parents: readonly string[];
}

export interface PublishContribution {
  readonly dir: string;
  readonly branch: string;
  readonly commit: string;
  readonly expectedHead: string | null;
}
