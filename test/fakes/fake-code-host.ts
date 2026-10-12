import type {
  ContributionPullRequest,
  CreatePullRequest,
  PullRequestLookup,
} from '../../src/domain/contribution/pull-request.js';
import type { RepositoryIdentity } from '../../src/domain/contribution/remote.js';
import { DevkitError } from '../../src/domain/errors.js';
import type {
  Branch,
  CodeHost,
  Commit,
  CommitRange,
  ForkResult,
  Readability,
  RepoRef,
} from '../../src/ports/code-host.js';

// A code host with scripted readability, branches, commits and files; forks
// are recorded, not made. Every query is logged so a test can say what was
// never asked.
export class FakeCodeHost implements CodeHost {
  supportsContributions = true;
  readonly identities = new Map<string, RepositoryIdentity>();
  readonly pullRequests = new Map<string, ContributionPullRequest>();
  readonly createdPullRequests: CreatePullRequest[] = [];
  readonly forks: string[] = [];
  readonly probes: string[] = [];
  readonly queries: string[] = [];
  user: string | undefined = 'alice';
  readability = new Map<string, Readability>();
  existingForks = new Set<string>();
  branchesOf = new Map<string, Branch[]>();
  // `<project>/<name> <from>..<to>` → the commits `to` has that `from` lacks.
  comparisons = new Map<string, Commit[]>();
  commits = new Map<string, Commit>();
  // `<project>/<name> <ref>:<path>` → file text.
  files = new Map<string, string>();
  // The same keys as `files`, for a read that fails.
  fileFailures = new Map<string, Error>();
  failure: Error | undefined;

  constructor(private readonly host = 'ssh://git@git.example.com:12345') {}

  async repositoryIdentity(ref: RepoRef): Promise<RepositoryIdentity> {
    this.ask(`identity ${key(ref)}`);
    const identity = this.identities.get(key(ref));
    if (!identity)
      throw new DevkitError(
        'config',
        'SOURCE_IDENTITY_UNVERIFIED',
        'No fake identity was configured.',
      );
    return identity;
  }

  async pullRequest(input: PullRequestLookup): Promise<ContributionPullRequest | null> {
    this.ask(`pr ${key(input.repo)}/${input.id}`);
    return this.pullRequests.get(`${key(input.repo)}/${input.id}`) ?? null;
  }

  async createPullRequest(input: CreatePullRequest): Promise<ContributionPullRequest> {
    this.ask('createPullRequest');
    this.createdPullRequests.push(input);
    const id = String(this.createdPullRequests.length);
    const result: ContributionPullRequest = {
      id,
      url: `https://git.example.com/pr/${id}`,
      state: 'open',
      source: input.source,
      target: input.target,
    };
    this.pullRequests.set(`${key(input.target.repo)}/${id}`, result);
    return result;
  }

  async whoami(): Promise<{ user: string }> {
    if (this.user === undefined)
      throw new DevkitError('auth', 'CODE_HOST_AUTH', 'fake code host: not signed in');
    return { user: this.user };
  }

  async canRead(ref: RepoRef): Promise<Readability> {
    this.probes.push(key(ref));
    return this.readability.get(key(ref)) ?? 'readable';
  }

  async fork(ref: RepoRef): Promise<ForkResult> {
    this.forks.push(key(ref));
    const url = this.forkUrl(this.user ?? 'me', ref);
    if (this.existingForks.has(key(ref))) return { url, created: false };
    this.existingForks.add(key(ref));
    return { url, created: true };
  }

  async branches(ref: RepoRef): Promise<Branch[]> {
    this.ask(`branches ${key(ref)}`);
    return this.branchesOf.get(key(ref)) ?? [];
  }

  async compare(ref: RepoRef, range: CommitRange): Promise<Commit[]> {
    this.ask(`compare ${key(ref)} ${range.from}..${range.to}`);
    return this.comparisons.get(`${key(ref)} ${range.from}..${range.to}`) ?? [];
  }

  async commit(ref: RepoRef, sha: string): Promise<Commit> {
    this.ask(`commit ${key(ref)} ${sha}`);
    const commit = this.commits.get(sha);
    if (commit === undefined) throw new Error(`fake code host: no commit ${sha}`);
    return commit;
  }

  async readFile(ref: RepoRef, path: string, at: string): Promise<string | undefined> {
    this.ask(`file ${key(ref)} ${at}:${path}`);
    const failure = this.fileFailures.get(`${key(ref)} ${at}:${path}`);
    if (failure !== undefined) throw failure;
    return this.files.get(`${key(ref)} ${at}:${path}`);
  }

  upstreamUrl(ref: RepoRef): string {
    return `${this.host}/${ref.project}/${ref.name}.git`;
  }

  forkUrl(user: string, ref: RepoRef): string {
    return `${this.host}/~${user}/${ref.name}.git`;
  }

  webUrl(ref: RepoRef): string {
    return `https://git.example.com/projects/${ref.project}/repos/${ref.name}/browse`;
  }

  private ask(query: string): void {
    this.queries.push(query);
    if (this.failure !== undefined) throw this.failure;
  }
}

function key(ref: RepoRef): string {
  return `${ref.project}/${ref.name}`;
}
