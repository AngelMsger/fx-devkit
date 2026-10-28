import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { TemplatePlatform } from '../../../../src/adapters/platform/template-platform.js';
import { Release } from '../../../../src/application/release/index.js';
import type { Check } from '../../../../src/domain/release/types.js';
import type { Platform } from '../../../../src/ports/platform.js';
import type { ProviderDescriptor } from '../../../../src/ports/provider.js';
import { FakeCi } from '../../../fakes/fake-ci.js';
import { FakeCodeHost } from '../../../fakes/fake-code-host.js';
import { FakeErrorTracker } from '../../../fakes/fake-error-tracker.js';
import { fakeLoginDeps } from '../../../fakes/fake-login-deps.js';
import { MANIFEST_DIR, harness } from '../../../fakes/workspace.js';

const fixture = (name: string): string =>
  readFileSync(path.resolve('test/fixtures/manifest/v1-real-shape', name), 'utf8');

const RELEASE_BLOCK = [
  'release:',
  '  env: dev',
  '  ci: { source_env: dev, target_env: prod }',
  '  bots: [ci-bot]',
  '',
].join('\n');

const descriptor = (id: string, capability: ProviderDescriptor<unknown>['capability']) => ({
  id,
  capability,
  tools: [id],
  recipes: [],
  vars: [],
  create: () => ({}),
});
const DESCRIPTORS: Record<string, ProviderDescriptor<unknown>> = {
  'bitbucket-cli': descriptor('bitbucket-cli', 'code-host'),
  'jenkins-cli': descriptor('jenkins-cli', 'ci'),
  sentry: descriptor('sentry', 'error-tracker'),
};
const TOOLS = ['bitbucket-cli', 'jenkins-cli', 'sentry'];

const commit = (sha: string, author: string, message: string, date = '2026-09-02T09:00:00Z') => ({
  sha,
  author,
  date,
  message,
  parents: ['p'],
});

interface StageOptions {
  readonly workspace?: string;
  readonly environments?: string;
  readonly tools?: readonly string[];
  readonly platforms?: Record<string, Platform>;
  readonly descriptors?: Record<string, ProviderDescriptor<unknown>>;
}

// fx-example-api has dev ahead of main, a -dev dependency, a failing target job and
// a fresh issue; fx-example-data has one branch and nothing wrong.
async function stage(options: StageOptions = {}) {
  const codeHost = new FakeCodeHost();
  codeHost.branchesOf.set('fx/fx-example-api', [
    { name: 'dev', sha: 'd1', default: true },
    { name: 'main', sha: 'm1', default: false },
  ]);
  codeHost.branchesOf.set('data/fx-example-data', [{ name: 'master', sha: 's1', default: true }]);
  codeHost.comparisons.set('fx/fx-example-api m1..d1', [
    commit('c1', 'alice', 'feat: m-1 thing'),
    commit('c2', 'ci-bot', 'bugfix: v1.2.3'),
  ]);
  codeHost.commits.set('d1', commit('d1', 'alice', 'head'));
  codeHost.commits.set('m1', commit('m1', 'alice', 'head', '2026-09-01T09:00:00Z'));
  codeHost.commits.set('s1', commit('s1', 'alice', 'head'));
  codeHost.files.set('fx/fx-example-api d1:package.json', '{"dependencies":{"x":"1.0.0-dev"}}');
  codeHost.files.set('data/fx-example-data s1:requirements.txt', 'httpx==0.27\n');
  const ci = new FakeCi();
  ci.builds.set('services/fx-example-api/feature%2Fdev', {
    number: 3,
    status: 'success',
    startedAt: '2026-09-02T10:00:00Z',
    url: null,
    commit: null,
  });
  ci.builds.set('services/fx-example-api/master', {
    number: 9,
    status: 'failure',
    startedAt: null,
    url: null,
    commit: null,
  });
  ci.builds.set('services/fx-example-data/feature%2Fdev', {
    number: 1,
    status: 'success',
    startedAt: '2026-09-02T10:00:00Z',
    url: null,
    commit: null,
  });
  ci.builds.set('services/fx-example-data/master', {
    number: 2,
    status: 'success',
    startedAt: '2026-09-02T10:00:00Z',
    url: null,
    commit: null,
  });
  const tracker = new FakeErrorTracker();
  tracker.issuesOf.set('fx-example-api-dev', [
    {
      id: '1',
      shortId: 'FX-EXAMPLE-API-DEV-1',
      title: 'boom',
      level: 'error',
      firstSeen: '2026-09-01T00:00:00Z',
      lastSeen: '2026-09-02T00:00:00Z',
      count: 4,
      url: null,
      culprit: null,
    },
  ]);
  const h = await harness({
    workspace: options.workspace ?? fixture('workspace.yaml') + RELEASE_BLOCK,
    files: {
      [`${MANIFEST_DIR}/manifest/environments.yaml`]:
        options.environments ?? fixture('environments.yaml'),
      [`${MANIFEST_DIR}/manifest/members.yaml`]: fixture('members.yaml'),
    },
    codeHost,
    platforms: options.platforms ?? { 'jenkins-cli': ci, sentry: tracker },
  });
  for (const tool of options.tools ?? TOOLS) h.process.binaries.add(tool);
  h.process.when((v) => v[1] === '--version', { code: 0, stdout: 'x 9.0.0', stderr: '' });
  const login = fakeLoginDeps(options.descriptors ?? DESCRIPTORS);
  login.clock.now = () => new Date('2026-09-03T00:00:00Z');
  return { h, codeHost, ci, tracker, release: new Release(h.deps, login) };
}

const run = (
  s: Awaited<ReturnType<typeof stage>>,
  extra: Partial<Parameters<Release['execute']>[0]> = {},
) => s.release.execute({ jobs: 2, ...extra });

const byKey = (report: { findings: readonly { group: string; id: string; level: string }[] }) =>
  Object.fromEntries(report.findings.map((f) => [`${f.group}:${f.id}`, f.level]));

describe('Release', () => {
  it('reports every check of every covered repository, checks first, repositories in manifest order', async () => {
    const s = await stage();
    const report = await run(s);
    expect(report.findings.map((f) => `${f.group}:${f.id}`)).toEqual([
      'deps:fx-example-api',
      'deps:fx-example-data',
      'deps:fx-example-legacy',
      'merge:fx-example-api',
      'merge:fx-example-data',
      'merge:fx-example-legacy',
      'ci:fx-example-api',
      'ci:fx-example-data',
      'ci:fx-example-legacy',
      'errors:fx-example-api',
      'errors:fx-example-data',
      'errors:fx-example-legacy',
    ]);
    expect(byKey(report)).toMatchObject({
      'deps:fx-example-api': 'fail',
      'merge:fx-example-api': 'fail',
      'ci:fx-example-api': 'fail',
      'errors:fx-example-api': 'fail',
      'deps:fx-example-data': 'ok',
      'merge:fx-example-data': 'ok',
      'ci:fx-example-data': 'ok',
      'errors:fx-example-data': 'ok',
    });
    expect(report.ok).toBe(false);
    expect(report.summary.fail).toBe(4);
  });

  it('attributes commits through members and leaves bots and merges out of the evidence', async () => {
    const s = await stage();
    const merge = (await run(s)).findings.find(
      (f) => f.group === 'merge' && f.id === 'fx-example-api',
    );
    expect(merge?.message).toBe('1 commit on dev not merged into main');
    expect(merge?.evidence).toMatchObject({
      source: 'dev',
      target: 'main',
      ahead: [{ sha: 'c1', author: { id: 'alice', name: 'Alice' } }],
      filtered: 1,
    });
  });

  it('treats a repository with a single branch as having nothing to merge', async () => {
    const s = await stage();
    const merge = (await run(s)).findings.find(
      (f) => f.group === 'merge' && f.id === 'fx-example-data',
    );
    expect(merge).toMatchObject({
      level: 'ok',
      message: 'one branch, no main or master, not checked',
    });
  });

  it('says an uncovered service is not checked for builds and errors, and still checks its code', async () => {
    const s = await stage();
    const report = await run(s);
    const legacy = report.findings.filter((f) => f.id === 'fx-example-legacy');
    expect(legacy.map((f) => [f.group, f.level])).toEqual([
      ['deps', 'warn'],
      ['merge', 'warn'],
      ['ci', 'ok'],
      ['errors', 'ok'],
    ]);
    expect(legacy[0]?.message).toContain('no branch dev');
    expect(legacy[2]?.message).toContain('not checked');
  });

  it('runs only the checks asked for, and asks no other platform', async () => {
    const s = await stage();
    const report = await run(s, { only: ['merge'] as Check[] });
    expect(new Set(report.findings.map((f) => f.group))).toEqual(new Set(['merge']));
    expect(s.ci.asked).toEqual([]);
    expect(s.tracker.asked).toEqual([]);
    // What each release would carry is still said: it is what the checks are about.
    expect(report.repos.find((r) => r.name === 'fx-example-api')?.source?.sha).toBe('d1');
  });

  it('says what each release would carry: both heads, their versions and how much is not merged', async () => {
    const s = await stage();
    s.codeHost.files.set(
      'fx/fx-example-api d1:package.json',
      '{"version":"1.3.0","dependencies":{"x":"1.0.0-dev"}}',
    );
    s.codeHost.files.set('fx/fx-example-api m1:package.json', '{"version":"1.2.0"}');
    const report = await run(s);
    expect(report.repos.map((r) => r.name)).toEqual([
      'fx-example-api',
      'fx-example-data',
      'fx-example-legacy',
    ]);
    const [api, data, legacy] = report.repos;
    expect(api).toMatchObject({
      source: { branch: 'dev', sha: 'd1', message: 'head', version: '1.3.0' },
      target: { branch: 'main', sha: 'm1', version: '1.2.0' },
      version_file: 'package.json',
      // Counted, not listed; the bot's commit is left out, as the merge check leaves it out.
      unmerged: { commits: 1, authors: 1 },
      note: null,
      unanswered: [],
    });
    // A requirements file declares no version, and a single branch has no target.
    expect(data).toMatchObject({
      source: { branch: 'master', version: null },
      target: null,
      version_file: null,
      unmerged: null,
    });
    // A repository without its source branch carries nothing anyone could name.
    expect(legacy).toMatchObject({ source: null, target: null, unmerged: null });
    // The checks and the summary share the host's answers rather than asking twice.
    const asked = (q: string) => s.codeHost.queries.filter((x) => x === q).length;
    expect(asked('file fx/fx-example-api d1:package.json')).toBe(1);
    expect(asked('commit fx/fx-example-api d1')).toBe(1);
    expect(asked('compare fx/fx-example-api m1..d1')).toBe(1);
  });

  it.each([undefined, '0.0.1'])(
    'prefers VERSION over package metadata (%s)',
    async (packageVersion) => {
      const s = await stage();
      s.codeHost.files.set('fx/fx-example-api d1:VERSION', ' 2.1.0\r\n');
      s.codeHost.files.set('fx/fx-example-api m1:VERSION', '2.0.0\n');
      s.codeHost.files.set(
        'fx/fx-example-api d1:package.json',
        JSON.stringify({ version: packageVersion, dependencies: { x: '1.0.0-dev' } }),
      );
      s.codeHost.files.set('fx/fx-example-api m1:package.json', '{"version":"0.0.1"}');
      // VERSION also works for repositories whose dependency file has no own version.
      s.codeHost.files.set('data/fx-example-data s1:VERSION', '3.0.0\n');
      const report = await run(s);
      expect(report.repos[0]).toMatchObject({
        source: { version: '2.1.0' },
        target: { version: '2.0.0' },
        version_file: 'VERSION',
        unanswered: [],
      });
      expect(report.repos[1]).toMatchObject({
        source: { version: '3.0.0' },
        version_file: 'VERSION',
      });
      expect(byKey(report)['deps:fx-example-api']).toBe('fail');
    },
  );

  it('says which question to the host failed, even one no check asks', async () => {
    const s = await stage();
    s.codeHost.files.set('fx/fx-example-api d1:package.json', '{"version":"1.3.0"}');
    // Only the description reads the target's version, so only it can say this failed.
    s.codeHost.fileFailures.set('fx/fx-example-api m1:package.json', new Error('timed out'));
    const report = await run(s);
    expect(report.repos.find((r) => r.name === 'fx-example-api')).toMatchObject({
      source: { version: '1.3.0' },
      target: { version: null },
      unanswered: [{ field: 'target.version', reason: expect.stringContaining('timed out') }],
    });
  });

  it('selects by name or tag, and refuses a name it does not know', async () => {
    const s = await stage();
    expect(
      (await run(s, { repos: ['fx-example-api'] })).findings.every(
        (f) => f.id === 'fx-example-api',
      ),
    ).toBe(true);
    expect(new Set((await run(s, { tags: ['data'] })).findings.map((f) => f.id))).toEqual(
      new Set(['fx-example-data']),
    );
    await expect(run(s, { repos: ['nope'] })).rejects.toMatchObject({
      code: 'REPO_NOT_FOUND',
      message: '"nope" is not a shared repository of workspace "fx"',
      nextSteps: ['fx repo list --workspace fx'],
    });
  });

  it('refuses a tag nobody carries and an environment the workspace does not declare', async () => {
    const s = await stage();
    await expect(run(s, { tags: ['ghost'] })).rejects.toMatchObject({ code: 'TAG_NOT_FOUND' });
    await expect(run(s, { env: 'prodcution' })).rejects.toMatchObject({ code: 'ENV_NOT_FOUND' });
  });

  it("reads the team's registry, not this machine's selection", async () => {
    const s = await stage();
    const picked = await harness({
      workspace: fixture('workspace.yaml') + RELEASE_BLOCK,
      files: {
        [`${MANIFEST_DIR}/manifest/environments.yaml`]: fixture('environments.yaml'),
      },
      local: { scope: { repos: ['fx-example-data'] } },
      codeHost: s.codeHost,
      platforms: { 'jenkins-cli': s.ci, sentry: s.tracker },
    });
    for (const tool of TOOLS) picked.process.binaries.add(tool);
    picked.process.when((v) => v[1] === '--version', { code: 0, stdout: 'x 9.0.0', stderr: '' });
    const release = new Release(picked.deps, fakeLoginDeps(DESCRIPTORS));
    const report = await release.execute({ jobs: 2, only: ['deps'] as Check[] });
    expect(report.findings.map((f) => f.id)).toEqual([
      'fx-example-api',
      'fx-example-data',
      'fx-example-legacy',
    ]);
  });

  it('keeps a repository marked covered: false off the report', async () => {
    const s = await stage({
      workspace:
        fixture('workspace.yaml').replace(
          '    obs: { svc: example-api }\n',
          '    obs: { svc: example-api }\n    release: { covered: false }\n',
        ) + RELEASE_BLOCK,
    });
    expect((await run(s)).findings.some((f) => f.id === 'fx-example-api')).toBe(false);
    await expect(run(s, { repos: ['fx-example-api'] })).rejects.toMatchObject({
      code: 'REPO_NOT_COVERED',
    });
  });

  it('refuses to report a pass on a workspace whose checklist is empty', async () => {
    const s = await stage({
      workspace:
        fixture('workspace.yaml').replace(
          /\n  - name: /g,
          '\n  - release: { covered: false }\n    name: ',
        ) + RELEASE_BLOCK,
    });
    await expect(run(s)).rejects.toMatchObject({ code: 'CHECKLIST_EMPTY' });
  });

  it('warns once per repository and check when the code host tool is not ready, asking it nothing', async () => {
    const s = await stage({ tools: ['jenkins-cli', 'sentry'] });
    const report = await run(s);
    const deps = report.findings.find((f) => f.group === 'deps' && f.id === 'fx-example-api');
    expect(deps).toMatchObject({
      level: 'warn',
      fix: 'fx tool install bitbucket-cli --workspace fx',
    });
    expect(deps?.handoff).toMatchObject({
      command: 'fx tool install bitbucket-cli --workspace fx',
    });
    expect(byKey(report)).toMatchObject({
      'merge:fx-example-api': 'warn',
      'ci:fx-example-api': 'warn',
      'errors:fx-example-api': 'fail',
    });
    expect(s.codeHost.queries).toEqual([]);
    expect(report.ok).toBe(false);
  });

  it('lets a query through when readiness could not tell, and reports what the query says', async () => {
    const s = await stage();
    s.h.process.clear();
    s.h.process.when((v) => v[1] === '--version', {
      code: 0,
      stdout: 'no version here',
      stderr: '',
    });
    const report = await run(s, { only: ['errors'] as Check[] });
    expect(byKey(report)).toMatchObject({
      'errors:fx-example-api': 'fail',
      'errors:fx-example-data': 'ok',
    });
    expect(s.tracker.asked.length).toBe(2);
  });

  it('asks a code host that drives no tool without any readiness question', async () => {
    const s = await stage({
      tools: [],
      descriptors: {
        ...DESCRIPTORS,
        'bitbucket-cli': { ...DESCRIPTORS['bitbucket-cli']!, tools: [] },
      },
    });
    const report = await run(s, { only: ['merge'] as Check[] });
    expect(byKey(report)).toMatchObject({ 'merge:fx-example-api': 'fail' });
    expect(s.codeHost.queries.length).toBeGreaterThan(0);
  });

  it('says so when the manifest names no environments for ci or errors, without asking a platform', async () => {
    const s = await stage({ workspace: fixture('workspace.yaml') });
    const report = await run(s);
    expect(byKey(report)).toMatchObject({
      'ci:fx-example-api': 'ok',
      'errors:fx-example-api': 'ok',
    });
    expect(report.findings.find((f) => f.group === 'errors')?.message).toBe(
      'no environment for errors in the release policy, not checked',
    );
    expect(s.ci.asked).toEqual([]);
    expect(s.tracker.asked).toEqual([]);
  });

  it('warns when the target environment has no ci platform, rather than passing on the source alone', async () => {
    const s = await stage({
      environments: fixture('environments.yaml').replace(
        "      jenkins: { vars: { path: 'services/{repo}/master' } }\n",
        '',
      ),
    });
    const ci = (await run(s, { only: ['ci'] as Check[] })).findings.find(
      (f) => f.id === 'fx-example-api',
    );
    expect(ci?.level).toBe('warn');
    expect(ci?.message).toContain('target: jenkins-cli is not covered for prod');
    // The source side was still asked, and still says what it found.
    expect(ci?.message).toContain('dev #3 succeeded, started after d1');
  });

  it('will not choose between two platforms serving the same capability in one environment', async () => {
    const s = await stage({
      environments: fixture('environments.yaml')
        .replace(
          '  jenkins:\n    label: Jenkins',
          "  jenkins2:\n    provider: jenkins-cli\n    capability: ci\n    command: 'jenkins-cli job get {path}'\n  jenkins:\n    label: Jenkins",
        )
        .replace(
          "      jenkins: { vars: { path: 'services/{repo}/feature%2Fdev' } }",
          "      jenkins: { vars: { path: 'services/{repo}/feature%2Fdev' } }\n      jenkins2: { vars: { path: 'second/{repo}/dev' } }",
        ),
    });
    const ci = (await run(s, { only: ['ci'] as Check[] })).findings.find(
      (f) => f.id === 'fx-example-api',
    );
    expect(ci?.evidence).toMatchObject({
      builds: [
        { side: 'source', number: null, status: null, current: null },
        { side: 'target', number: 9, status: 'failure' },
      ],
    });
    // The other side, served by one platform, still says what it found.
    expect(ci?.level).toBe('fail');
  });

  it('warns when the ci platform cannot answer the question, and never guesses', async () => {
    const template = new TemplatePlatform({
      id: 'jenkins-cli',
      capability: 'ci',
      label: 'job',
      command: ['jenkins-cli', 'x'],
    });
    const s = await stage({
      platforms: { 'jenkins-cli': template, sentry: new FakeErrorTracker() },
    });
    const ci = (await run(s, { only: ['ci'] as Check[] })).findings.find(
      (f) => f.id === 'fx-example-api',
    );
    expect(ci?.level).toBe('warn');
    expect(ci?.message).toContain('jenkins-cli offers no lastBuild query');
  });

  it('judges a build by the commit it checked out and tells the platform which branch it checks', async () => {
    const s = await stage();
    // Started before the head commit was written, yet built from it: pushed late.
    s.ci.builds.set('services/fx-example-data/feature%2Fdev', {
      number: 1,
      status: 'success',
      startedAt: '2026-08-01T00:00:00Z',
      url: null,
      commit: 's1',
    });
    const report = await run(s, { only: ['ci'] as Check[] });
    const ci = report.findings.find((f) => f.id === 'fx-example-data');
    expect(ci).toMatchObject({
      level: 'ok',
      message: expect.stringContaining('master #1 succeeded, built s1'),
    });
    expect(ci?.evidence).toMatchObject({
      builds: expect.arrayContaining([expect.objectContaining({ commit: 's1', current: true })]),
    });
    expect(s.ci.queries).toContainEqual({ branch: 'master' });
  });

  it("lets --env and --since override the manifest's release policy", async () => {
    const s = await stage();
    await run(s, { only: ['errors'] as Check[], env: 'prod', since: '2d' });
    expect(s.tracker.asked).toEqual([
      { slug: 'fx-example-api', since: '2d' },
      { slug: 'fx-example-data-prod', since: '2d' },
    ]);
    await expect(run(s, { since: 'soon' })).rejects.toMatchObject({ code: 'BAD_SINCE' });
  });

  it('turns one repository failing a query into its own warning, not the report failing', async () => {
    const s = await stage();
    s.tracker.failure = new Error('sentry: rate limited');
    const report = await run(s, { only: ['errors'] as Check[] });
    expect(byKey(report)).toEqual({
      'errors:fx-example-api': 'warn',
      'errors:fx-example-data': 'warn',
      'errors:fx-example-legacy': 'ok',
    });
    expect(report.findings[0]?.message).toBe('sentry: rate limited');
    expect(report.ok).toBe(true);
  });
});
