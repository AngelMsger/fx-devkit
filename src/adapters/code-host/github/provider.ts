// GitHub as the code host, through gh. Branches, ranges, commits and files come from
// the REST API by way of `gh api`, so gh holds the credential and fx never sees it.
// Pull requests are not wired yet: contribution workflows report this host as
// unsupported instead of half-working.

import type {
  ContributionPullRequest,
  CreatePullRequest,
  PullRequestLookup,
} from '../../../domain/contribution/pull-request.js';
import type { RepositoryIdentity } from '../../../domain/contribution/remote.js';
import { DevkitError } from '../../../domain/errors.js';
import { repoUrl } from '../../../domain/workspace/ref.js';
import type {
  Branch,
  CodeHost,
  Commit,
  CommitRange,
  ForkResult,
  Readability,
  RepoRef,
} from '../../../ports/code-host.js';
import type { AdapterDeps, ProviderDescriptor, Vars } from '../../../ports/provider.js';
import { EXIT, objectOf, queryFailed, stringAt, unreadableError } from '../../family/cli.js';
import {
  BINARY,
  DEFAULT_HOSTNAME,
  GH_RECIPES,
  GhCli,
  jsonLines,
  type CliCall,
  type GhCallOptions,
} from '../../github/gh.js';

const QUERY = { timeoutMs: 15_000 } as const;
// The fields of a commit the release check reads, so a commit's diff never crosses the pipe.
const COMMIT =
  '{sha, author: .commit.author.name, date: .commit.committer.date, message: .commit.message, parents: [.parents[].sha]}';

export class GitHubCodeHost implements CodeHost {
  readonly supportsContributions = false;
  private readonly gh: GhCli;

  constructor(
    deps: AdapterDeps,
    private readonly vars: Vars,
  ) {
    this.gh = new GhCli(deps.process);
  }

  async repositoryIdentity(_ref: RepoRef): Promise<RepositoryIdentity> {
    throw contributionUnsupported();
  }

  async pullRequest(_input: PullRequestLookup): Promise<ContributionPullRequest | null> {
    throw contributionUnsupported();
  }

  async createPullRequest(_input: CreatePullRequest): Promise<ContributionPullRequest> {
    throw contributionUnsupported();
  }

  async whoami(): Promise<{ user: string }> {
    const call = await this.api('user', ['--jq', '.login'], { timeoutMs: 5000 });
    const user = call.stdout.trim();
    if (call.code !== 0 || user === '') throw queryFailed(BINARY, call, 'tell who is signed in');
    return { user };
  }

  async canRead(ref: RepoRef): Promise<Readability> {
    const call = await this.api(`repos/${slug(ref)}`, ['--jq', '.full_name'], { timeoutMs: 5000 });
    if (call.code === 0) return 'readable';
    if (call.code === EXIT.permission) return 'forbidden';
    // GitHub answers 404 for a private repository the person cannot see, too.
    if (call.code === EXIT.not_found) return 'missing';
    return 'unknown';
  }

  async fork(ref: RepoRef): Promise<ForkResult> {
    const { user } = await this.whoami();
    const url = this.forkUrl(user, ref);
    const existing = await this.api(
      `repos/${user}/${ref.name}`,
      ['--jq', '{fork, parent: .parent.full_name, source: .source.full_name}'],
      QUERY,
    );
    if (existing.code === 0) {
      // Being a fork does not say of which repository: only one forked from this
      // upstream, or from a fork whose network starts at it, can carry its pull requests.
      const found = objectOf(existing.data) ?? {};
      const of = [stringAt(found, 'parent'), stringAt(found, 'source')];
      if (of.some((name) => name?.toLowerCase() === slug(ref).toLowerCase()))
        return { url, created: false };
      // A repository of that name that is not this fork would make gh pick another name.
      throw forkFailed(
        ref,
        found['fork'] === true
          ? `${user}/${ref.name} is a fork of ${of[0] ?? 'another repository'}`
          : `${user}/${ref.name} exists and is not a fork`,
      );
    }
    const call = await this.gh.call(
      ['repo', 'fork', `${this.hostname}/${slug(ref)}`, '--clone=false', '--remote=false'],
      QUERY,
    );
    if (call.code !== 0) throw forkFailed(ref, call.error?.message ?? `exit ${call.code}`);
    return { url, created: true };
  }

  async branches(ref: RepoRef): Promise<Branch[]> {
    const [list, repo] = await Promise.all([
      this.api(`repos/${slug(ref)}/branches?per_page=100`, [
        '--paginate',
        '--jq',
        '.[] | {name, sha: .commit.sha}',
      ]),
      this.api(`repos/${slug(ref)}`, ['--jq', '.default_branch']),
    ]);
    if (list.code !== 0) throw queryFailed(BINARY, list, `list the branches of ${slug(ref)}`);
    if (repo.code !== 0) throw queryFailed(BINARY, repo, `read the default branch of ${slug(ref)}`);
    const defaultBranch = repo.stdout.trim();
    return records(list, `the branches of ${slug(ref)}`).map((item) => {
      const name = stringAt(item, 'name');
      const sha = stringAt(item, 'sha');
      if (name === undefined || sha === undefined)
        throw unreadableError(BINARY, `a branch of ${slug(ref)}`);
      return { name, sha, default: name === defaultBranch };
    });
  }

  // Every page, checked against the total GitHub states: a list shorter than the range
  // would read as branches that agree.
  async compare(ref: RepoRef, range: CommitRange): Promise<Commit[]> {
    const what = `${range.from}..${range.to} of ${slug(ref)}`;
    const call = await this.api(
      `repos/${slug(ref)}/compare/${refPath(range.from)}...${refPath(range.to)}?per_page=100`,
      ['--paginate', '--jq', `{total: .total_commits, commits: [.commits[] | ${COMMIT}]}`],
    );
    if (call.code !== 0) throw queryFailed(BINARY, call, `compare ${what}`);
    const pages = records(call, what);
    const commits = pages.flatMap((page) =>
      Array.isArray(page['commits']) ? page['commits'].map(objectOf) : [undefined],
    );
    const total = pages[0]?.['total'];
    if (typeof total !== 'number' || commits.length !== total)
      throw unreadableError(BINARY, `an incomplete list of the commits in ${what}`);
    return commits.map((item) => {
      const commit = item === undefined ? undefined : commitOf(item);
      if (commit === undefined) throw unreadableError(BINARY, `a commit of ${what}`);
      return commit;
    });
  }

  async commit(ref: RepoRef, sha: string): Promise<Commit> {
    const call = await this.api(`repos/${slug(ref)}/commits/${refPath(sha)}`, ['--jq', COMMIT]);
    const commit = call.code === 0 ? commitOf(objectOf(call.data) ?? {}) : undefined;
    if (commit === undefined) throw queryFailed(BINARY, call, `read commit ${sha} of ${slug(ref)}`);
    return commit;
  }

  async readFile(ref: RepoRef, path: string, at: string): Promise<string | undefined> {
    const call = await this.api(
      `repos/${slug(ref)}/contents/${refPath(path)}?ref=${encodeURIComponent(at)}`,
      ['-H', 'Accept: application/vnd.github.raw'],
    );
    if (call.code === 0) return call.stdout;
    if (call.code === EXIT.not_found) return undefined;
    throw queryFailed(BINARY, call, `read ${path} at ${at} of ${slug(ref)}`);
  }

  upstreamUrl(ref: RepoRef): string {
    return repoUrl(this.host, ref.project, ref.name);
  }

  forkUrl(user: string, ref: RepoRef): string {
    return repoUrl(this.host, user, ref.name);
  }

  webUrl(ref: RepoRef): string {
    return `https://${this.hostname}/${slug(ref)}`;
  }

  // gh signs in per host and would otherwise pick one from GH_HOST or its configuration,
  // so every call names the host the binding names, github.com included.
  private api(
    path: string,
    args: readonly string[],
    options: GhCallOptions = QUERY,
  ): Promise<CliCall> {
    return this.gh.call(['api', '--hostname', this.hostname, ...args, path], options);
  }

  private get host(): string {
    return this.vars['host'] ?? '';
  }

  private get hostname(): string {
    return hostnameOf(this.host);
  }
}

export const githubProvider: ProviderDescriptor<CodeHost> = {
  id: 'github',
  capability: 'code-host',
  tools: [BINARY],
  recipes: GH_RECIPES,
  vars: [
    {
      name: 'host',
      desc: 'git clone prefix, e.g. https://github.com, or an ssh:// prefix for SSH clones',
      required: true,
    },
  ],
  recipeVars: (vars) => ({ hostname: hostnameOf(vars['host'] ?? '') }),
  create: (deps, vars) => new GitHubCodeHost(deps, vars),
};

// An https:// or an ssh:// clone prefix names its host; anything else means github.com.
function hostnameOf(host: string): string {
  try {
    return new URL(host).hostname || DEFAULT_HOSTNAME;
  } catch {
    return DEFAULT_HOSTNAME;
  }
}

function records(call: CliCall, what: string): Record<string, unknown>[] {
  const rows = jsonLines(call.stdout)?.map(objectOf);
  if (rows === undefined || rows.some((row) => row === undefined))
    throw unreadableError(BINARY, what);
  return rows as Record<string, unknown>[];
}

function slug(ref: RepoRef): string {
  return `${ref.project}/${ref.name}`;
}

// A branch or path keeps its slashes; anything else that means something in a URL is escaped.
function refPath(value: string): string {
  return value.split('/').map(encodeURIComponent).join('/');
}

function commitOf(item: Record<string, unknown>): Commit | undefined {
  const sha = stringAt(item, 'sha');
  const date = stringAt(item, 'date');
  if (sha === undefined || date === undefined) return undefined;
  const parents = Array.isArray(item['parents'])
    ? item['parents'].filter((p): p is string => typeof p === 'string')
    : [];
  return {
    sha,
    author: stringAt(item, 'author') ?? '',
    date,
    message: stringAt(item, 'message') ?? '',
    parents,
  };
}

function forkFailed(ref: RepoRef, reason: string): DevkitError {
  return new DevkitError(
    'permission',
    'FORK_FAILED',
    `${BINARY} could not fork ${slug(ref)}: ${reason}`,
    {
      hint: 'Forking needs read access to the repository and a free name in your account.',
      nextSteps: [`${BINARY} repo view ${slug(ref)}`, 'fx repo list --unreadable'],
    },
  );
}

function contributionUnsupported(): DevkitError {
  return new DevkitError(
    'config',
    'SOURCE_CONTRIBUTION_UNSUPPORTED',
    'The github code host does not open pull requests through fx yet',
    { nextSteps: ['Open the pull request with gh pr create.'] },
  );
}
