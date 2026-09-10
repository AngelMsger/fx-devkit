// Jenkins through jenkins-cli: coordinates and probe come from the shared
// template; the one query reads a job's latest build. A job that is not
// there is an answer (undefined), a job that cannot be read is an error.

import type { Coordinate, ProbeVector } from '../../../domain/obs/types.js';
import type { Vars } from '../../../domain/template.js';
import type { Build, BuildStatus, Ci } from '../../../ports/ci.js';
import type { Process } from '../../../ports/process.js';
import { EXIT, FamilyCli, objectOf, queryFailed, stringAt, unreadable } from '../../family/cli.js';
import { TemplatePlatform } from '../../platform/template-platform.js';

export const BINARY = 'jenkins-cli';
const QUERY = { timeoutMs: 15_000 } as const;
const STATUSES: readonly BuildStatus[] = [
  'success',
  'failure',
  'unstable',
  'aborted',
  'building',
  'not_built',
];

export class JenkinsCi implements Ci {
  readonly id = BINARY;
  readonly capability = 'ci' as const;
  private readonly platform = new TemplatePlatform({
    id: BINARY,
    capability: 'ci',
    label: 'Jenkins job {path}',
    optionalFlags: { context: '--use-context' },
    command: [BINARY, 'build', 'list', '{path}'],
    probe: { label: 'job {path}', command: [BINARY, 'job', 'get', '--', '{path}'] },
  });

  constructor(private readonly process: Process) {}

  locate(vars: Vars): Coordinate {
    return this.platform.locate(vars);
  }

  probe(vars: Vars): ProbeVector | undefined {
    return this.platform.probe(vars);
  }

  async lastBuild(vars: Vars): Promise<Build | undefined> {
    const path = vars['path'] ?? '';
    // A workspace with two Jenkins servers names the one it means; without
    // a context the CLI's own selection stands.
    const cli = new FamilyCli(BINARY, this.process, vars['context']);
    const call = await cli.call(['build', 'get', path], QUERY);
    if (call.code === EXIT.not_found) return undefined;
    const data = objectOf(call.data);
    if (call.code !== 0 || data === undefined)
      throw queryFailed(BINARY, call, `read the last build of ${path}`);
    if (typeof data['number'] !== 'number') throw unreadable(BINARY, `the last build of ${path}`);
    return {
      number: data['number'],
      status: statusOf(data),
      startedAt: stringAt(data, 'started_at') ?? null,
      url: stringAt(data, 'url') ?? null,
    };
  }
}

function statusOf(data: Record<string, unknown>): BuildStatus {
  if (data['building'] === true) return 'building';
  const status = stringAt(data, 'status');
  return STATUSES.find((s) => s === status) ?? 'unknown';
}
