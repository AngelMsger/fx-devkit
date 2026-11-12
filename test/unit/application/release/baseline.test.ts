import { describe, expect, it } from 'vitest';

import { readBaseline } from '../../../../src/application/release/baseline.js';
import type { Commit } from '../../../../src/domain/workspace/commits.js';
import { FakeCodeHost } from '../../../fakes/fake-code-host.js';

const ref = { project: 'example', name: 'library' };
const commit = (sha: string): Commit => ({
  sha,
  author: 'Example',
  date: '2026-01-01T00:00:00Z',
  parents: [],
  message: 'Change',
});

describe('explicit historical baseline', () => {
  it('resolves refs once and compares full history using only immutable SHAs', async () => {
    const host = new FakeCodeHost();
    host.commits.set('v1.0.0', commit('aaa'));
    host.commits.set('head-sha', commit('head-sha'));
    host.files.set('example/library aaa:VERSION', '1.0.0');
    host.files.set('example/library head-sha:VERSION', '1.1.0');
    const allCommits = [commit('already-merged'), commit('not-merged')];
    host.comparisons.set('example/library aaa..head-sha', allCommits);
    const actual = await readBaseline({
      host,
      ref,
      baselineRef: 'v1.0.0',
      headRef: 'main',
      headSha: 'head-sha',
    });
    expect(actual).toMatchObject({
      baseline: { requested_ref: 'v1.0.0', resolved_sha: 'aaa', declaration: { value: '1.0.0' } },
      head: { requested_ref: 'main', resolved_sha: 'head-sha', declaration: { value: '1.1.0' } },
      coverage: 'checked',
      commits: allCommits,
    });
    expect(host.queries).toContain('compare example/library aaa..head-sha');
    expect(host.queries).not.toContain('commit example/library main');
    expect(
      host.queries
        .filter((query) => query.startsWith('file'))
        .every((query) => !query.includes('v1.0.0:') && !query.includes('main:')),
    ).toBe(true);
  });

  it('discovers Maven baseline declarations alongside Python requirements', async () => {
    const host = new FakeCodeHost();
    host.commits.set('before', commit('aaa'));
    host.commits.set('after', commit('bbb'));
    for (const [sha, version] of [
      ['aaa', '1.0.0'],
      ['bbb', '1.1.0'],
    ]) {
      host.files.set(`example/library ${sha}:requirements.txt`, 'mkdocs==1.6.0');
      host.files.set(
        `example/library ${sha}:pom.xml`,
        `<project><artifactId>library</artifactId><version>${version}</version></project>`,
      );
    }
    expect(
      await readBaseline({ host, ref, baselineRef: 'before', headRef: 'after' }),
    ).toMatchObject({
      baseline: { declaration: { file: 'pom.xml', value: '1.0.0' } },
      head: { declaration: { file: 'pom.xml', value: '1.1.0' } },
      coverage: 'checked',
      failures: [],
    });
  });

  it('retains the range without certifying composite Maven baseline declarations', async () => {
    const host = new FakeCodeHost();
    host.commits.set('before', commit('aaa'));
    host.commits.set('after', commit('bbb'));
    for (const [sha, version] of [
      ['aaa', '1.0.0'],
      ['bbb', '1.1.0'],
    ]) {
      host.files.set(
        `example/library ${sha}:pom.xml`,
        `<project><version>\${revision}\${changelist}</version><properties>
          <revision>${version}</revision><changelist>-SNAPSHOT</changelist>
        </properties></project>`,
      );
    }
    const commits = [commit('bbb')];
    host.comparisons.set('example/library aaa..bbb', commits);
    expect(
      await readBaseline({ host, ref, baselineRef: 'before', headRef: 'after' }),
    ).toMatchObject({
      baseline: { resolved_sha: 'aaa', declaration: null },
      head: { resolved_sha: 'bbb', declaration: null },
      commits,
      coverage: 'incomplete',
      failures: [
        { code: 'VERSION_DECLARATION_UNREADABLE' },
        { code: 'VERSION_DECLARATION_UNREADABLE' },
      ],
    });
  });

  it('retains the range when a historical declaration is missing', async () => {
    const host = new FakeCodeHost();
    host.commits.set('before', commit('aaa'));
    host.commits.set('after', commit('bbb'));
    host.files.set('example/library bbb:VERSION', '1.1.0');
    expect(
      await readBaseline({ host, ref, baselineRef: 'before', headRef: 'after' }),
    ).toMatchObject({
      baseline: { resolved_sha: 'aaa', declaration: null },
      coverage: 'incomplete',
      commits: [],
      failures: [{ code: 'VERSION_PATH_MISSING' }],
    });
  });

  it('retains readable head evidence if the requested baseline cannot be resolved', async () => {
    const host = new FakeCodeHost();
    host.commits.set('after', commit('bbb'));
    host.files.set('example/library bbb:VERSION', '1.1.0');
    expect(
      await readBaseline({ host, ref, baselineRef: 'missing', headRef: 'after' }),
    ).toMatchObject({
      baseline: { requested_ref: 'missing', resolved_sha: null },
      head: { resolved_sha: 'bbb', declaration: { value: '1.1.0' } },
      coverage: 'incomplete',
      commits: null,
    });
  });
});
