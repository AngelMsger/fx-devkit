// Bitbucket Data Center through bitbucket-cli. The CLI classifies HTTP
// failures into the family categories, so readability is read off its exit
// code; a duplicate fork answers 409, which is "already there", not a fault.
// Queries take `--all` so a long branch list or a long diff never stops at
// the first page.

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
import { EXIT, itemsOf, objectOf, queryFailed, stringAt, unreadable } from '../../family/cli.js';

import { BINARY, BitbucketCli, type CliCall } from './client.js';
import { createContributionPullRequest, readContributionPullRequest } from './pull-request.js';
import { BITBUCKET_RECIPES } from './recipes.js';
import { readRepositoryIdentity } from './repository-identity.js';

const QUERY = { timeoutMs: 15_000 } as const;

export class BitbucketCodeHost implements CodeHost {
  readonly supportsContributions = true;
  private readonly cli: BitbucketCli;

  constructor(
    deps: AdapterDeps,
    private readonly vars: Vars,
  ) {
    this.cli = new BitbucketCli(deps.process, vars['context']);
  }

  repositoryIdentity(ref: RepoRef): Promise<RepositoryIdentity> {
    return readRepositoryIdentity({ cli: this.cli, ref, branches: () => this.branches(ref) });
  }

  pullRequest(input: PullRequestLookup): Promise<ContributionPullRequest | null> {
    return readContributionPullRequest({ cli: this.cli, input });
  }

  createPullRequest(input: CreatePullRequest): Promise<ContributionPullRequest> {
    return createContributionPullRequest({ cli: this.cli, input });
  }

  async whoami(): Promise<{ user: string }> {
    const call = await this.cli.call(['whoami']);
    const data = objectOf(call.data);
    const user = data?.['name'] ?? data?.['slug'];
    if (call.code !== 0 || typeof user !== 'string' || user === '') {
      // exit 0 with no name is the common Data Center case, not a failure of the CLI.
      throw new DevkitError(
        'auth',
        'CODE_HOST_AUTH',
        `${BINARY} did not report a user name: ${detail(call)}`,
        {
          hint: 'A token-authenticated Data Center host may not say who is asking; tell fx yourself.',
          nextSteps: ['fx config set user <your code-host user name>', `${BINARY} auth status`],
        },
      );
    }
    return { user };
  }

  async canRead(ref: RepoRef): Promise<Readability> {
    const call = await this.cli.call(['repo', 'get', slug(ref)]);
    if (call.code === 0) return 'readable';
    if (call.code === EXIT.permission) return 'forbidden';
    if (call.code === EXIT.not_found) return 'missing';
    return 'unknown';
  }

  async fork(ref: RepoRef): Promise<ForkResult> {
    const call = await this.cli.call(['repo', 'fork', slug(ref)]);
    if (call.code === 0)
      return {
        url: cloneUrl(call) ?? this.forkUrl((await this.whoami()).user, ref),
        created: true,
      };
    if (call.code === EXIT.conflict) {
      const { user } = await this.whoami();
      const existing = await this.cli.call([
        'repo',
        'get',
        slug({ project: `~${user}`, name: ref.name }),
      ]);
      return { url: cloneUrl(existing) ?? this.forkUrl(user, ref), created: false };
    }
    throw new DevkitError(
      'permission',
      'FORK_FAILED',
      `${BINARY} could not fork ${slug(ref)}: ${detail(call)}`,
      {
        hint: 'Forking needs read access to the repository and a personal project on the host.',
        nextSteps: [`${BINARY} repo get ${slug(ref)}`, 'fx repo list --unreadable'],
      },
    );
  }

  async branches(ref: RepoRef): Promise<Branch[]> {
    const call = await this.cli.call(['branch', 'list', '--repo', slug(ref), '--all'], QUERY);
    if (call.code !== 0) throw queryFailed(BINARY, call, `list the branches of ${slug(ref)}`);
    return rows(call.data, `the branches of ${slug(ref)}`).map((item) => {
      const name = stringAt(item, 'name');
      const sha = stringAt(item, 'last_commit') ?? stringAt(item, 'target');
      if (name === undefined || sha === undefined)
        throw unreadable(BINARY, `a branch of ${slug(ref)}`);
      return { name, sha, default: item['default'] === true };
    });
  }

  async compare(ref: RepoRef, range: CommitRange): Promise<Commit[]> {
    const call = await this.cli.call(
      ['commit', 'compare', '--repo', slug(ref), '--from', range.from, '--to', range.to, '--all'],
      QUERY,
    );
    if (call.code !== 0)
      throw queryFailed(BINARY, call, `compare ${range.from}..${range.to} of ${slug(ref)}`);
    const what = `${range.from}..${range.to} of ${slug(ref)}`;
    return rows(call.data, what).map((item) => {
      const commit = commitOf(item);
      if (commit === undefined) throw unreadable(BINARY, `a commit of ${what}`);
      return commit;
    });
  }

  async commit(ref: RepoRef, sha: string): Promise<Commit> {
    const call = await this.cli.call(['commit', 'get', sha, '--repo', slug(ref)], QUERY);
    const commit = call.code === 0 ? commitOf(objectOf(call.data) ?? {}) : undefined;
    if (commit === undefined) throw queryFailed(BINARY, call, `read commit ${sha} of ${slug(ref)}`);
    return commit;
  }

  async readFile(ref: RepoRef, path: string, at: string): Promise<string | undefined> {
    const call = await this.cli.call(
      ['file', 'get', slug(ref), '--path', path, '--ref', at, '--output', '-'],
      QUERY,
    );
    if (call.code === 0) return call.stdout;
    if (call.code === EXIT.not_found) return undefined;
    throw queryFailed(BINARY, call, `read ${path} at ${at} of ${slug(ref)}`);
  }

  upstreamUrl(ref: RepoRef): string {
    return repoUrl(this.host, ref.project, ref.name);
  }

  forkUrl(user: string, ref: RepoRef): string {
    return repoUrl(this.host, `~${user}`, ref.name);
  }

  webUrl(ref: RepoRef): string {
    const web = this.vars['web'];
    return web === undefined
      ? this.upstreamUrl(ref)
      : `${web.replace(/\/+$/, '')}/projects/${ref.project}/repos/${ref.name}/browse`;
  }

  private get host(): string {
    return this.vars['host'] ?? '';
  }
}

export const bitbucketCliProvider: ProviderDescriptor<CodeHost> = {
  id: 'bitbucket-cli',
  capability: 'code-host',
  tools: [BINARY],
  recipes: BITBUCKET_RECIPES,
  vars: [
    { name: 'host', desc: 'git clone prefix, e.g. ssh://git@git.example.com:12345', required: true },
    { name: 'web', desc: 'browser base URL, e.g. https://git.example.com', required: false },
    {
      name: 'context',
      desc: 'bitbucket-cli context name when more than one host is configured',
      required: false,
    },
  ],
  create: (deps, vars) => new BitbucketCodeHost(deps, vars),
};

// Every page or nothing: a list fx cannot read whole would answer "no
// branches" or "no commits between them", which is a wrong answer, not a
// missing one.
function rows(data: unknown, what: string): Record<string, unknown>[] {
  const items = itemsOf(data);
  if (items === undefined) throw unreadable(BINARY, what);
  return items;
}

function slug(ref: RepoRef): string {
  return `${ref.project}/${ref.name}`;
}

function cloneUrl(call: CliCall): string | undefined {
  return stringAt(objectOf(call.data) ?? {}, 'clone_ssh');
}

function detail(call: CliCall): string {
  return call.error?.message ?? `exit ${call.code}`;
}

// The CLI reports a commit's date as epoch milliseconds in a string.
function commitOf(item: Record<string, unknown>): Commit | undefined {
  const sha = stringAt(item, 'hash') ?? stringAt(item, 'id');
  const date = stringAt(item, 'date');
  if (sha === undefined || date === undefined) return undefined;
  const parents = Array.isArray(item['parents'])
    ? item['parents'].filter((p): p is string => typeof p === 'string')
    : [];
  return {
    sha,
    author: stringAt(item, 'author') ?? '',
    date: isoOf(date),
    message: stringAt(item, 'message') ?? '',
    parents,
  };
}

function isoOf(date: string): string {
  return /^\d+$/.test(date) ? new Date(Number(date)).toISOString() : date;
}
