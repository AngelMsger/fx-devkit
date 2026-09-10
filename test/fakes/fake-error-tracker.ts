import type { Coordinate } from '../../src/domain/obs/types.js';
import type { Vars } from '../../src/domain/template.js';
import type { ErrorTracker, Issue, IssuePage, IssueQuery } from '../../src/ports/error-tracker.js';

// An error tracker whose issues are scripted by project slug; every question is logged.
export class FakeErrorTracker implements ErrorTracker {
  readonly id = 'fake-tracker';
  readonly capability = 'error-tracker' as const;
  readonly asked: { slug: string; since: string }[] = [];
  issuesOf = new Map<string, Issue[]>();
  more = false;
  failure: Error | undefined;

  locate(vars: Vars): Coordinate {
    return { label: `issues of ${vars['slug']}`, command: ['fake-tracker', vars['slug'] ?? ''] };
  }

  async issues(vars: Vars, query: IssueQuery): Promise<IssuePage> {
    const slug = vars['slug'] ?? '';
    this.asked.push({ slug, since: query.since });
    if (this.failure !== undefined) throw this.failure;
    return { issues: this.issuesOf.get(slug) ?? [], more: this.more };
  }
}
