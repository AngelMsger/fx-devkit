// GitHub Actions through gh: a job is one workflow of one repository, narrowed to the
// runs of one branch and one trigger. One workflow often runs on pushes, pull requests
// and by hand, and only the coordinate knows which of those builds what ships; a
// coordinate that names no branch counts the runs of the branch being checked. A
// workflow that is not there is an answer (undefined), a workflow that cannot be read
// is an error.

import type { Coordinate, ProbeVector } from '../../../domain/obs/types.js';
import type { Vars } from '../../../domain/template.js';
import type { Build, BuildQuery, BuildStatus, Ci } from '../../../ports/ci.js';
import type { Process } from '../../../ports/process.js';
import { EXIT, objectOf, queryFailed, stringAt, unreadableError } from '../../family/cli.js';
import { BINARY, GhCli, qualifiedRepository } from '../../github/gh.js';
import { TemplatePlatform } from '../../platform/template-platform.js';

export const ID = 'github-actions';
const QUERY = { timeoutMs: 15_000 } as const;
const RUNS = ['run', 'list', '--repo', '{repository}', '--workflow', '{workflow}'];
const FIELDS = 'number,status,conclusion,startedAt,createdAt,url,headSha';

// A run still on its way, by gh's status; a finished run says how it ended instead.
const PENDING = new Set(['queued', 'in_progress', 'waiting', 'requested', 'pending']);
const CONCLUSIONS: Readonly<Record<string, BuildStatus>> = {
  success: 'success',
  failure: 'failure',
  timed_out: 'failure',
  startup_failure: 'failure',
  cancelled: 'aborted',
  skipped: 'not_built',
};

export class GitHubActionsCi implements Ci {
  readonly id = ID;
  readonly capability = 'ci' as const;
  private readonly platform = new TemplatePlatform({
    id: ID,
    capability: 'ci',
    label: 'GitHub Actions workflow {workflow} in {repository}',
    optionalFlags: { branch: '--branch', event: '--event' },
    command: [BINARY, ...RUNS],
    probe: { label: 'workflow {workflow} in {repository}', command: [BINARY, ...RUNS] },
  });

  constructor(private readonly process: Process) {}

  locate(vars: Vars): Coordinate {
    return this.platform.locate(qualified(vars));
  }

  probe(vars: Vars): ProbeVector | undefined {
    return this.platform.probe(qualified(vars));
  }

  async lastBuild(vars: Vars, query: BuildQuery): Promise<Build | undefined> {
    const { repository = '', workflow = '', branch = query.branch, event } = qualified(vars);
    const what = `the last run of ${workflow} in ${repository}${branch ? ` on ${branch}` : ''}`;
    const call = await new GhCli(this.process).call(
      [
        'run',
        'list',
        '--repo',
        repository,
        '--workflow',
        workflow,
        ...(branch ? ['--branch', branch] : []),
        ...(event ? ['--event', event] : []),
        '--limit',
        '1',
        '--json',
        FIELDS,
      ],
      QUERY,
    );
    if (call.code === EXIT.not_found) return undefined;
    if (call.code !== 0 || !Array.isArray(call.data))
      throw queryFailed(BINARY, call, `read ${what}`);
    // A workflow that never ran on that branch has no build to judge.
    if (call.data.length === 0) return undefined;
    const run = objectOf(call.data[0]);
    if (run === undefined || typeof run['number'] !== 'number') throw unreadableError(BINARY, what);
    return {
      number: run['number'],
      status: statusOf(run),
      startedAt: stringAt(run, 'startedAt') ?? stringAt(run, 'createdAt') ?? null,
      url: stringAt(run, 'url') ?? null,
      commit: stringAt(run, 'headSha') ?? null,
    };
  }
}

// Every command, run or printed, names the repository's host, so GH_HOST cannot send
// it elsewhere.
function qualified(vars: Vars): Vars {
  const { repository } = vars;
  return repository === undefined
    ? vars
    : { ...vars, repository: qualifiedRepository(repository).repository };
}

function statusOf(run: Record<string, unknown>): BuildStatus {
  const status = stringAt(run, 'status') ?? '';
  if (PENDING.has(status)) return 'building';
  if (status !== 'completed') return 'unknown';
  return CONCLUSIONS[stringAt(run, 'conclusion') ?? ''] ?? 'unknown';
}
