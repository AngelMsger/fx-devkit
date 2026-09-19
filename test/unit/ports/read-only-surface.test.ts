import { describe, expect, it } from 'vitest';

import { larkCalendarProvider } from '../../../src/adapters/calendar/lark-calendar/provider.js';
import { wecomCalendarProvider } from '../../../src/adapters/calendar/wecom-calendar/provider.js';
import { JenkinsCi } from '../../../src/adapters/ci/jenkins-cli/ci.js';
import { BitbucketCodeHost } from '../../../src/adapters/code-host/bitbucket-cli/provider.js';
import { LocalGitCodeHost } from '../../../src/adapters/code-host/local-git/provider.js';
import { SentryErrorTracker } from '../../../src/adapters/error-tracker/sentry/tracker.js';
import { larkProvider } from '../../../src/adapters/im/lark/provider.js';
import { feishuProjectProvider } from '../../../src/adapters/issue-tracker/feishu-project/provider.js';
import { jiraCliProvider } from '../../../src/adapters/issue-tracker/jira-cli/provider.js';
import { confluenceProvider } from '../../../src/adapters/knowledge-base/confluence/provider.js';
import { larkWikiProvider } from '../../../src/adapters/knowledge-base/lark-wiki/provider.js';
import { larkTaskProvider } from '../../../src/adapters/task/lark-task/provider.js';
import { wecomTodoProvider } from '../../../src/adapters/task/wecom-todo/provider.js';
import { jiraWorklogProvider } from '../../../src/adapters/worklog/jira-worklog/provider.js';
import { FakeClock } from '../../fakes/fake-clock.js';
import { FakeFs } from '../../fakes/fake-fs.js';
import { FakeProcess } from '../../fakes/fake-process.js';

// Everything fx can ask a platform to do, pinned by name. A method added
// here is reviewed as a query or as an explicitly named legacy write.
const CODE_HOST_READS = [
  'whoami',
  'repositoryIdentity',
  'pullRequest',
  'canRead',
  'branches',
  'compare',
  'commit',
  'readFile',
  'upstreamUrl',
  'forkUrl',
  'webUrl',
];

const CODE_HOST_LEGACY_WRITES = ['fork'];
const CODE_HOST_CONTRIBUTION_WRITES = ['createPullRequest'];

// The private helpers each adapter is allowed, spelled out: a method that
// is not one of them is a method fx can call on a platform.
const HELPERS = ['constructor', 'host', 'git'];

const methodsOf = (ctor: { prototype: object }): string[] =>
  Object.getOwnPropertyNames(ctor.prototype).filter((n) => !HELPERS.includes(n));

describe('the read-only surface towards platforms', () => {
  it.each([
    feishuProjectProvider,
    jiraCliProvider,
    jiraWorklogProvider,
    confluenceProvider,
    larkWikiProvider,
    larkProvider,
    larkCalendarProvider,
    wecomCalendarProvider,
    larkTaskProvider,
    wecomTodoProvider,
  ])('$id creates data and offers no business methods', (provider) => {
    const process = new FakeProcess();
    const entry = provider.create(
      { process, fs: new FakeFs(), clock: new FakeClock() },
      {
        project_key: 'team',
        project: 'TEAM',
        base_url: 'https://wiki.example.com',
        space: 'TEAM',
      },
    );
    expect(Object.values(entry).some((value) => typeof value === 'function')).toBe(false);
    expect(process.calls).toEqual([]);
    expect(
      provider.recipes.every((recipe) => recipe.kind === 'manual' && recipe.run === undefined),
    ).toBe(true);
  });

  it.each([
    ['bitbucket-cli', BitbucketCodeHost],
    ['local-git', LocalGitCodeHost],
  ])('%s offers exactly the code-host methods', (_id, ctor) => {
    expect(new Set(methodsOf(ctor))).toEqual(
      new Set([...CODE_HOST_READS, ...CODE_HOST_LEGACY_WRITES, ...CODE_HOST_CONTRIBUTION_WRITES]),
    );
  });

  it('a ci platform locates, probes and reads one build; nothing triggers', () => {
    expect(new Set(methodsOf(JenkinsCi))).toEqual(new Set(['locate', 'probe', 'lastBuild']));
  });

  it('an error tracker locates, probes and lists issues; nothing resolves', () => {
    expect(new Set(methodsOf(SentryErrorTracker))).toEqual(new Set(['locate', 'probe', 'issues']));
  });
});
