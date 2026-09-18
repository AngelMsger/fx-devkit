// A code host that is a directory of bare repositories: `host/PROJECT/name.git`
// upstream, `host/~user/name.git` forks. It exists so the workspace can be
// exercised end to end without a server, and it is the first proof that a
// provider is one manifest line away from being swapped. Queries run git
// against the bare repository itself, so no checkout is ever involved.

import path from 'node:path';

import type {
  ContributionPullRequest,
  CreatePullRequest,
  PullRequestLookup,
} from '../../../domain/contribution/pull-request.js';
import type { RepositoryIdentity } from '../../../domain/contribution/remote.js';
import { DevkitError } from '../../../domain/errors.js';
import { refFromUrl, repoUrl } from '../../../domain/workspace/ref.js';
import type {
  Branch,
  CodeHost,
  Commit,
  CommitRange,
  ForkResult,
  Readability,
  RepoRef,
} from '../../../ports/code-host.js';
import type { ProcessResult } from '../../../ports/process.js';
import type { AdapterDeps, ProviderDescriptor, Vars } from '../../../ports/provider.js';

// One line per commit: sha, author, ISO committer date, parents, subject.
const COMMIT_FORMAT = '--format=%H%x00%an%x00%cI%x00%P%x00%s';
const MISSING_PATH = /does not exist|exists on disk, but not in|invalid object name/i;

export class LocalGitCodeHost implements CodeHost {
  readonly supportsContributions = false;
  constructor(
    private readonly deps: AdapterDeps,
    private readonly vars: Vars,
  ) {}

  async repositoryIdentity(ref: RepoRef): Promise<RepositoryIdentity> {
    const branches = await this.branches(ref);
    const defaultBranch = branches.find((branch) => branch.default)?.name;
    if (!defaultBranch) throw contributionUnsupported();
    const origin = await this.git(ref, ['config', '--get', 'remote.origin.url']);
    if (origin.code !== 0 && origin.code !== 1) throw failed(ref, 'read fork identity', origin);
    return {
      ref,
      cloneUrls: [this.upstreamUrl(ref)],
      defaultBranch,
      personalOwner: ref.project.startsWith('~') ? ref.project.slice(1) : null,
      parent: origin.code === 1 ? null : refFromUrl(origin.stdout.trim()),
    };
  }

  async pullRequest(_input: PullRequestLookup): Promise<ContributionPullRequest | null> {
    throw contributionUnsupported();
  }

  async createPullRequest(_input: CreatePullRequest): Promise<ContributionPullRequest> {
    throw contributionUnsupported();
  }

  async whoami(): Promise<{ user: string }> {
    return { user: this.vars['user'] ?? 'me' };
  }

  async canRead(ref: RepoRef): Promise<Readability> {
    return (await this.deps.fs.exists(this.upstreamUrl(ref))) ? 'readable' : 'missing';
  }

  async fork(ref: RepoRef): Promise<ForkResult> {
    const { user } = await this.whoami();
    const url = this.forkUrl(user, ref);
    if (await this.deps.fs.exists(url)) return { url, created: false };
    const result = await this.deps.process.run([
      'git',
      'clone',
      '--quiet',
      '--bare',
      this.upstreamUrl(ref),
      url,
    ]);
    if (result.code !== 0) {
      throw new DevkitError(
        'permission',
        'FORK_FAILED',
        `Could not fork ${ref.project}/${ref.name}: ${result.stderr.trim()}`,
        {
          nextSteps: [`ls ${path.dirname(url)}`],
        },
      );
    }
    return { url, created: true };
  }

  async branches(ref: RepoRef): Promise<Branch[]> {
    const head = await this.git(ref, ['symbolic-ref', '--short', 'HEAD']);
    const refs = await this.git(ref, [
      'for-each-ref',
      '--format=%(refname:short)%00%(objectname)',
      'refs/heads',
    ]);
    if (refs.code !== 0) throw failed(ref, 'list branches', refs);
    const defaultBranch = head.code === 0 ? head.stdout.trim() : undefined;
    return lines(refs.stdout).map((line) => {
      const [name, sha] = line.split('\0');
      if (name === undefined || sha === undefined || sha === '')
        throw unreadableError(ref, 'a branch', line);
      return { name, sha, default: name === defaultBranch };
    });
  }

  async compare(ref: RepoRef, range: CommitRange): Promise<Commit[]> {
    const result = await this.git(ref, ['rev-list', COMMIT_FORMAT, range.to, `^${range.from}`]);
    if (result.code !== 0) throw failed(ref, `compare ${range.from}..${range.to}`, result);
    return commitsOf(ref, result.stdout);
  }

  async commit(ref: RepoRef, sha: string): Promise<Commit> {
    const result = await this.git(ref, ['rev-list', '-1', COMMIT_FORMAT, sha]);
    const [commit] = result.code === 0 ? commitsOf(ref, result.stdout) : [];
    if (commit === undefined) throw failed(ref, `read commit ${sha}`, result);
    return commit;
  }

  async readFile(ref: RepoRef, file: string, at: string): Promise<string | undefined> {
    const result = await this.git(ref, ['show', `${at}:${file}`]);
    if (result.code === 0) return result.stdout;
    if (MISSING_PATH.test(result.stderr)) return undefined;
    throw failed(ref, `read ${file} at ${at}`, result);
  }

  upstreamUrl(ref: RepoRef): string {
    return repoUrl(this.host, ref.project, ref.name);
  }

  forkUrl(user: string, ref: RepoRef): string {
    return repoUrl(this.host, `~${user}`, ref.name);
  }

  webUrl(ref: RepoRef): string {
    return this.upstreamUrl(ref);
  }

  private git(ref: RepoRef, args: readonly string[]): Promise<ProcessResult> {
    return this.deps.process.run(['git', '--git-dir', this.upstreamUrl(ref), ...args]);
  }

  private get host(): string {
    return this.vars['host'] ?? '';
  }
}

export const localGitProvider: ProviderDescriptor<CodeHost> = {
  id: 'local-git',
  capability: 'code-host',
  tools: [],
  recipes: [],
  vars: [
    {
      name: 'host',
      desc: 'directory holding <project>/<name>.git bare repositories',
      required: true,
    },
    {
      name: 'user',
      desc: 'name of the personal namespace (~user); defaults to "me"',
      required: false,
    },
  ],
  create: (deps, vars) => new LocalGitCodeHost(deps, vars),
};

function failed(ref: RepoRef, what: string, result: ProcessResult): DevkitError {
  return new DevkitError(
    'server',
    'PLATFORM_QUERY_FAILED',
    `git could not ${what} in ${ref.project}/${ref.name}: ${result.stderr.trim() || `exit ${result.code}`}`,
    { nextSteps: ['fx repo list --unreadable'] },
  );
}

function lines(text: string): string[] {
  return text.split('\n').filter((line) => line !== '');
}

// rev-list prints a `commit <sha>` header before each formatted line; the
// formatted line is the one carrying the format's separators, whatever the
// repository's hash length. A line that is neither is not skipped: a row
// nobody can read would shorten a comparison into "the branches agree".
function commitsOf(ref: RepoRef, text: string): Commit[] {
  return lines(text).flatMap((line) => {
    if (!line.includes('\0')) {
      if (line.startsWith('commit ')) return [];
      throw unreadableError(ref, 'a commit', line);
    }
    const [sha, author, date, parents, message] = line.split('\0');
    if (sha === undefined || sha === '' || date === undefined)
      throw unreadableError(ref, 'a commit', line);
    return [
      {
        sha,
        author: author ?? '',
        date,
        message: message ?? '',
        parents: (parents ?? '').split(' ').filter((p) => p !== ''),
      },
    ];
  });
}

function unreadableError(ref: RepoRef, what: string, line: string): DevkitError {
  return new DevkitError(
    'server',
    'PLATFORM_QUERY_FAILED',
    `git answered with ${what} fx could not read in ${ref.project}/${ref.name}: ${line.slice(0, 80)}`,
    { nextSteps: ['fx repo list --unreadable'] },
  );
}

function contributionUnsupported(): DevkitError {
  return new DevkitError(
    'config',
    'SOURCE_CONTRIBUTION_UNSUPPORTED',
    'This local code host has no pull-request service',
    { nextSteps: ['Select a code-host provider with pull-request support.'] },
  );
}
