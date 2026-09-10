import type { ContributionOperation } from '../../src/domain/contribution/operation.js';
import type { ContributionRemoteSettings } from '../../src/domain/contribution/remote.js';
import { DevkitError } from '../../src/domain/errors.js';
import type {
  CaptureContribution,
  ConstructContribution,
  ConstructedContribution,
  ContributionCommit,
  ContributionGit,
  ContributionSnapshot,
  InspectContribution,
  PublishContribution,
} from '../../src/ports/contribution-git.js';
import type { ContributionStore } from '../../src/ports/contribution-store.js';
import type {
  ContributionPush,
  ContributionRemoteBranch,
  ContributionTransport,
  ContributionUpstream,
  FetchContributionBase,
} from '../../src/ports/contribution-transport.js';

export const BASE = 'a'.repeat(40);
export const BASE_TREE = 'b'.repeat(40);
export const TREE = 'c'.repeat(40);
export const SOURCE = { project: '~alice', name: 'manifest' };
export const TARGET = { project: 'TEAM', name: 'manifest' };
export const SETTINGS: ContributionRemoteSettings = {
  originUrls: ['ssh://git@git.example.com/~alice/manifest.git'],
  pushUrls: ['ssh://git@git.example.com/~alice/manifest.git'],
  upstreamUrls: ['ssh://git@git.example.com/TEAM/manifest.git'],
  hasRewrite: false,
  isMirror: false,
  receivePack: null,
  fingerprint: 'settings',
};

export class FakeContributionGit implements ContributionGit {
  tree = TREE;
  available = true;
  fingerprint = 'snapshot';
  files = ['a.md'];
  readonly prepared: ConstructContribution[] = [];
  readonly published: PublishContribution[] = [];
  readonly commits = new Map<string, ContributionCommit>();
  beforePublish: (() => void) | undefined;
  captureCalls = 0;

  async capture(input: CaptureContribution): Promise<ContributionSnapshot> {
    this.captureCalls++;
    return {
      ...input,
      head: BASE,
      files: this.files.map((path) => ({
        path,
        kind: 'file',
        mode: '100644',
        content: 'selected private contents',
      })),
      baseFiles: { 'a.md': 'base' },
      fingerprint: this.fingerprint,
      tree: this.tree,
    };
  }
  async prepare(input: ConstructContribution): Promise<ConstructedContribution> {
    this.prepared.push(input);
    const commit = (this.prepared.length + 12).toString(16).padStart(40, '0');
    this.commits.set(commit, { sha: commit, tree: input.snapshot.tree, parents: [input.parent] });
    return { commit, tree: input.snapshot.tree };
  }
  async publish(input: PublishContribution): Promise<void> {
    this.beforePublish?.();
    this.published.push(input);
  }
  async inspect(input: InspectContribution): Promise<ContributionCommit | null> {
    if (input.ref === BASE)
      return this.available ? { sha: BASE, tree: BASE_TREE, parents: [] } : null;
    return this.commits.get(input.ref) ?? null;
  }
  async readBase(): Promise<Readonly<Record<string, string>>> {
    return { 'manifest/workspace.yaml': 'captured base config' };
  }
}

export class FakeContributionTransport implements ContributionTransport {
  settings = SETTINGS;
  readonly heads = new Map<string, string>();
  readonly pushes: ContributionPush[] = [];
  readonly fetches: FetchContributionBase[] = [];
  failHead = false;
  losePushResponse = false;
  onFetch: (() => void) | undefined;
  async inspect(): Promise<ContributionRemoteSettings> {
    return this.settings;
  }
  async upstream(): Promise<ContributionUpstream> {
    return { sha: BASE, branch: 'main' };
  }
  async fetch(input: FetchContributionBase): Promise<void> {
    this.fetches.push(input);
    this.onFetch?.();
  }
  async head(input: ContributionRemoteBranch): Promise<string | null> {
    if (this.failHead) throw new DevkitError('network', 'NETWORK', 'No remote answer.');
    return this.heads.get(input.branch) ?? null;
  }
  async push(input: ContributionPush): Promise<void> {
    this.pushes.push(input);
    this.heads.set(input.branch, input.commit);
    if (this.losePushResponse)
      throw new DevkitError('network', 'NETWORK', 'Push response was lost.');
  }
}

export class FakeContributionStore implements ContributionStore {
  operations: readonly ContributionOperation[] = [];
  readonly writes: (readonly ContributionOperation[])[] = [];
  failPhase: string | undefined;
  async read(): Promise<readonly ContributionOperation[]> {
    return structuredClone(this.operations);
  }
  async write(_workspace: string, operations: readonly ContributionOperation[]): Promise<void> {
    if (operations.some((op) => op.phase === this.failPhase))
      throw new DevkitError('internal', 'JOURNAL_WRITE_FAILED', 'Journal write failed.');
    this.operations = structuredClone(operations);
    this.writes.push(this.operations);
  }
}
