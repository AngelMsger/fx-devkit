import type { Coordinate } from '../../src/domain/obs/types.js';
import type { Vars } from '../../src/domain/template.js';
import type { Build, BuildQuery, Ci } from '../../src/ports/ci.js';

// A ci platform whose builds are scripted by job path; every question is logged.
export class FakeCi implements Ci {
  readonly id = 'fake-ci';
  readonly capability = 'ci' as const;
  readonly asked: string[] = [];
  readonly queries: BuildQuery[] = [];
  builds = new Map<string, Build | undefined>();
  failure: Error | undefined;

  locate(vars: Vars): Coordinate {
    return { label: `job ${vars['path']}`, command: ['fake-ci', 'build', vars['path'] ?? ''] };
  }

  async lastBuild(vars: Vars, query: BuildQuery): Promise<Build | undefined> {
    const path = vars['path'] ?? '';
    this.asked.push(path);
    this.queries.push(query);
    if (this.failure !== undefined) throw this.failure;
    return this.builds.get(path);
  }
}
