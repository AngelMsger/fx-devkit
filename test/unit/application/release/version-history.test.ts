import { describe, expect, it } from 'vitest';

import { readVersionDeclaration } from '../../../../src/application/release/version-declaration.js';
import { readVersionHistory } from '../../../../src/application/release/version-history.js';
import { DevkitError } from '../../../../src/domain/errors.js';
import { FakeCodeHost } from '../../../fakes/fake-code-host.js';

const ref = { project: 'example', name: 'library' };
const date = '2026-01-02T00:00:00Z';

function history(versions: readonly string[], file = 'package.json'): FakeCodeHost {
  const host = new FakeCodeHost();
  versions.forEach((version, index) => {
    const sha = `c${index}`;
    host.commits.set(sha, {
      sha,
      author: 'Example',
      date,
      message: 'Change',
      parents: index === 0 ? [] : [`c${index - 1}`],
    });
    host.files.set(
      `example/library ${sha}:${file}`,
      file.endsWith('VERSION') ? version : JSON.stringify({ name: '@example/library', version }),
    );
  });
  const head = host.commits.get(`c${versions.length - 1}`);
  if (head !== undefined) host.commits.set('main', head);
  return host;
}

describe('version declaration evidence', () => {
  it('prefers VERSION and does not fall back when it is empty', async () => {
    const host = history(['1.0.0']);
    host.files.set('example/library c0:VERSION', '2.0.0\n');
    expect(await readVersionDeclaration({ host, ref, sha: 'c0' })).toMatchObject({
      file: 'VERSION',
      field: 'text',
      value: '2.0.0',
    });
    host.files.set('example/library c0:VERSION', ' \n');
    await expect(readVersionDeclaration({ host, ref, sha: 'c0' })).rejects.toMatchObject({
      code: 'VERSION_DECLARATION_UNREADABLE',
    });
  });

  it('stops at unreadable supported metadata before a later readable declaration', async () => {
    const host = new FakeCodeHost();
    host.files.set('example/library c0:pyproject.toml', '[project]\ndynamic = ["version"]');
    host.files.set('example/library c0:pom.xml', '<project><version>1.2.3</version></project>');
    await expect(readVersionDeclaration({ host, ref, sha: 'c0' })).rejects.toMatchObject({
      code: 'VERSION_DECLARATION_UNREADABLE',
      message: 'pyproject.toml has no readable version declaration at c0',
    });
  });

  it('uses an explicit subpackage and reports its identity', async () => {
    const host = history(['1.0.0'], 'packages/library/package.json');
    host.files.set('example/library c0:VERSION', '9.0.0');
    expect(
      await readVersionDeclaration({ host, ref, sha: 'c0', path: 'packages/library/package.json' }),
    ).toEqual({
      file: 'packages/library/package.json',
      field: '/version',
      value: '1.0.0',
      package_name: '@example/library',
    });
    await expect(
      readVersionDeclaration({ host, ref, sha: 'c0', path: '../package.json' }),
    ).rejects.toMatchObject({ code: 'VERSION_PATH_INVALID' });
  });

  it('records the actual Gradle fallback declaration', async () => {
    const host = new FakeCodeHost();
    host.files.set('example/library c0:build.gradle', "plugins { id 'java' }\n");
    host.files.set('example/library c0:gradle.properties', 'version=1.2.0\n');
    expect(await readVersionDeclaration({ host, ref, sha: 'c0' })).toMatchObject({
      file: 'gradle.properties',
      field: 'version',
      value: '1.2.0',
    });
  });
});

describe('version field history', () => {
  it('ignores dependency, script and formatting edits and pins the ref before reading', async () => {
    const host = history(['1.0.0', '1.1.0', '1.1.0', '1.1.0']);
    host.files.set(
      'example/library c3:package.json',
      '{"scripts":{"test":"test"},"version":"1.1.0", "name":"@example/library"}',
    );
    host.files.set(
      'example/library c2:package.json',
      JSON.stringify(
        { version: '1.1.0', name: '@example/library', dependencies: { other: '2.0.0' } },
        null,
        2,
      ),
    );
    const actual = await readVersionHistory({ host, ref, requestedRef: 'main' });
    expect(actual).toMatchObject({
      requested_ref: 'main',
      resolved_sha: 'c3',
      coverage: 'checked',
      commits_read: 3,
      termination: 'changed',
      next_sha: null,
      last_change: {
        commit_sha: 'c1',
        committed_at: date,
        previous_value: '1.0.0',
        current_value: '1.1.0',
        history_mode: 'first_parent',
      },
    });
    expect(host.queries.some((query) => query.includes('main:'))).toBe(false);
  });

  it('finds Maven version changes when the repository also has Python requirements', async () => {
    const host = history(['1.0.0', '1.1.0']);
    for (const [sha, version] of [
      ['c0', '1.0.0'],
      ['c1', '1.1.0'],
    ]) {
      host.files.delete(`example/library ${sha}:package.json`);
      host.files.set(`example/library ${sha}:requirements.txt`, 'mkdocs==1.6.0');
      host.files.set(
        `example/library ${sha}:pom.xml`,
        `<project><version>\${revision}</version><properties><revision>${version}</revision></properties></project>`,
      );
    }
    expect(await readVersionHistory({ host, ref, requestedRef: 'main' })).toMatchObject({
      coverage: 'checked',
      declaration: { file: 'pom.xml', field: '/project/properties/revision', value: '1.1.0' },
      last_change: { commit_sha: 'c1', previous_value: '1.0.0', current_value: '1.1.0' },
      failures: [],
    });
  });

  it('leaves composite Maven version history incomplete when a component changes', async () => {
    const host = history(['1.0.0', '1.1.0']);
    for (const [sha, version] of [
      ['c0', '1.0.0'],
      ['c1', '1.1.0'],
    ]) {
      host.files.delete(`example/library ${sha}:package.json`);
      host.files.set(
        `example/library ${sha}:pom.xml`,
        `<project><version>\${revision}\${changelist}</version><properties>
          <revision>${version}</revision><changelist>-SNAPSHOT</changelist>
        </properties></project>`,
      );
    }
    expect(await readVersionHistory({ host, ref, requestedRef: 'main' })).toMatchObject({
      coverage: 'incomplete',
      declaration: null,
      last_change: null,
      termination: 'boundary',
      next_sha: 'c1',
      failures: [{ code: 'VERSION_DECLARATION_UNREADABLE' }],
    });
  });

  it('records a merge on the first-parent branch despite non-monotonic dates', async () => {
    const host = history(['1.0.0', '1.1.0', '1.1.0']);
    host.commits.set('c1', {
      sha: 'c1',
      author: 'Example',
      date: '2025-01-01T00:00:00Z',
      message: 'Merge',
      parents: ['c0', 'side'],
    });
    expect(await readVersionHistory({ host, ref, requestedRef: 'main' })).toMatchObject({
      coverage: 'checked',
      last_change: { commit_sha: 'c1', committed_at: '2025-01-01T00:00:00Z' },
    });
    expect(host.queries).not.toContain('commit example/library side');
  });

  it('records reintroduction after a rollback, rather than the original bump', async () => {
    const host = history(['1.0.0', '1.1.0', '1.0.0', '1.1.0']);
    expect(await readVersionHistory({ host, ref, requestedRef: 'main' })).toMatchObject({
      last_change: { commit_sha: 'c3', previous_value: '1.0.0', current_value: '1.1.0' },
    });
  });

  it('leaves rename, file introduction and field changes as explicit boundaries', async () => {
    const host = history(['1.0.0', '1.1.0']);
    host.files.delete('example/library c0:package.json');
    expect(await readVersionHistory({ host, ref, requestedRef: 'main' })).toMatchObject({
      coverage: 'incomplete',
      last_change: null,
      termination: 'boundary',
      next_sha: 'c0',
      failures: [{ code: 'VERSION_PATH_MISSING' }],
    });
    host.files.set(
      'example/library c0:package.json',
      '{"name":"another-package","version":"1.0.0"}',
    );
    expect(await readVersionHistory({ host, ref, requestedRef: 'main' })).toMatchObject({
      failures: [{ code: 'VERSION_SOURCE_CHANGED' }],
    });
  });

  it('reports an unreadable parent without manufacturing a root or a change date', async () => {
    const host = history(['1.0.0', '1.0.0']);
    host.commits.delete('c0');
    expect(await readVersionHistory({ host, ref, requestedRef: 'main' })).toMatchObject({
      coverage: 'incomplete',
      last_change: null,
      next_sha: 'c0',
      termination: 'query_failed',
    });
  });

  it('bounds work and keeps the next first-parent SHA', async () => {
    const host = history(['1.0.0', '1.0.0', '1.0.0']);
    expect(
      await readVersionHistory({ host, ref, requestedRef: 'main', maxCommits: 1 }),
    ).toMatchObject({
      coverage: 'incomplete',
      commits_read: 1,
      next_sha: 'c1',
      termination: 'limit',
      failures: [{ code: 'VERSION_HISTORY_LIMIT' }],
    });
    expect(host.queries).not.toContain('commit example/library c0');
  });

  it('recognizes a readable root and leaves an invalid timestamp unknown', async () => {
    const host = history(['1.0.0']);
    expect(await readVersionHistory({ host, ref, requestedRef: 'main' })).toMatchObject({
      coverage: 'checked',
      termination: 'root_declaration',
      last_change: { previous_value: null, kind: 'root_declaration' },
    });
    const root = host.commits.get('main');
    if (root !== undefined) host.commits.set('main', { ...root, date: 'unknown' });
    expect(await readVersionHistory({ host, ref, requestedRef: 'main' })).toMatchObject({
      coverage: 'incomplete',
      last_change: { committed_at: null },
      failures: [{ code: 'VERSION_CHANGE_UNDATED' }],
    });
  });

  it('preserves structured query failures and the readable declaration', async () => {
    const host = history(['1.0.0', '1.1.0']);
    host.fileFailures.set(
      'example/library c0:package.json',
      new DevkitError('rate_limit', 'LIMITED', 'Try later', { nextSteps: ['Wait.'] }),
    );
    expect(await readVersionHistory({ host, ref, requestedRef: 'main' })).toMatchObject({
      declaration: { value: '1.1.0' },
      coverage: 'incomplete',
      failures: [
        { code: 'LIMITED', category: 'rate_limit', retryable: true, next_steps: ['Wait.'] },
      ],
    });
  });
});
