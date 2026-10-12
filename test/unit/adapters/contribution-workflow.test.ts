import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, realpathSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { SystemClock } from '../../../src/adapters/clock/system-clock.js';
import { NodeFs } from '../../../src/adapters/fs/node-fs.js';
import { SnapshotReader } from '../../../src/adapters/fs/snapshot-reader.js';
import { ContributionSystemGit } from '../../../src/adapters/git/contribution-system-git.js';
import { ContributionGitTransport } from '../../../src/adapters/git/contribution-transport.js';
import { NodeProcess } from '../../../src/adapters/process/node-process.js';
import { PushSource } from '../../../src/application/contribution/push.js';
import { ValidateContribution } from '../../../src/application/contribution/validate.js';
import { providerCatalog } from '../../../src/composition/registry.js';
import { FileContributionStore } from '../../../src/infra/contribution-store.js';
import { FileLock } from '../../../src/infra/lock.js';
import { FakeCodeHost } from '../../fakes/fake-code-host.js';
import { FakeConfigStore } from '../../fakes/fake-config-store.js';
import { FakePrompter } from '../../fakes/fake-prompter.js';

const roots: string[] = [];
const git = (dir: string, ...args: string[]): string =>
  execFileSync('git', ['-C', dir, ...args], {
    encoding: 'utf8',
    env: { ...process.env, GIT_OPTIONAL_LOCKS: '0' },
  });
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('native contribution workflow with a durable journal', () => {
  it('validates only the candidate and can reload its completed operation without another push', async () => {
    const home = realpathSync.native(mkdtempSync(path.join(tmpdir(), 'fx-contribution-workflow-')));
    roots.push(home);
    const source = path.join(home, 'workspaces/test/source');
    mkdirSync(path.join(source, 'manifest'), { recursive: true });
    git(source, 'init', '-q', '-b', 'main');
    git(source, 'config', 'user.name', 'Fixture');
    git(source, 'config', 'user.email', 'fixture@example.com');
    const workspace =
      'schema_version: 2\nproviders:\n  code-host: { provider: local-git, vars: { host: https://git.example.com } }\ndefaults: { branch: main }\nrepos: [{ name: example, desc: Example repository }]\n';
    writeFileSync(path.join(source, 'manifest/workspace.yaml'), workspace);
    writeFileSync(path.join(source, 'notes.md'), 'base');
    git(source, 'add', '--', 'manifest/workspace.yaml', 'notes.md');
    git(source, 'commit', '-qm', 'initial');
    const upstream = path.join(home, 'TEAM/manifest.git');
    const origin = path.join(home, '~alice/manifest.git');
    mkdirSync(path.dirname(upstream));
    mkdirSync(path.dirname(origin));
    git(source, 'clone', '--bare', '-q', source, upstream);
    git(source, 'clone', '--bare', '-q', upstream, origin);
    git(source, 'remote', 'add', 'upstream', upstream);
    git(source, 'remote', 'add', 'origin', origin);
    writeFileSync(path.join(source, 'notes.md'), 'selected contribution');
    writeFileSync(path.join(source, 'manifest/workspace.yaml'), 'unrelated broken YAML: [');
    const before = {
      head: git(source, 'rev-parse', 'HEAD'),
      index: readFileSync(path.join(source, '.git/index')),
      status: git(source, 'status', '--porcelain=v1'),
    };
    const host = new FakeCodeHost();
    host.identities.set('TEAM/manifest', {
      ref: { project: 'TEAM', name: 'manifest' },
      cloneUrls: [upstream],
      defaultBranch: 'main',
      personalOwner: null,
      parent: null,
    });
    host.identities.set('~alice/manifest', {
      ref: { project: '~alice', name: 'manifest' },
      cloneUrls: [origin],
      defaultBranch: 'main',
      personalOwner: 'alice',
      parent: { project: 'TEAM', name: 'manifest' },
    });
    const process = new NodeProcess();
    const lock = new FileLock(home);
    let id = 0;
    const expected = { root: home, source: upstream };
    const deps = {
      registration: {
        expected,
        physicalRoot: expected.root,
        logicalSourceDir: source,
        config: new FakeConfigStore({ workspaces: { test: expected } }),
        fs: new NodeFs(lock),
      },
      source: { workspace: 'test', dir: source, kind: 'repo' as const },
      git: new ContributionSystemGit(process),
      transport: new ContributionGitTransport(process),
      records: new FileContributionStore(home, lock),
      hostFor: (files: Readonly<Record<string, string>>) => {
        expect(files['manifest/workspace.yaml']).toBe(workspace);
        return host;
      },
      validator: new ValidateContribution(
        {
          open: (files) => ({
            root: '/candidate',
            reader: new SnapshotReader({ root: '/candidate', files }),
          }),
        },
        () => readFileSync('defaults/tools.yaml', 'utf8'),
        providerCatalog(),
      ),
      clock: new SystemClock(),
      lock,
      prompter: new FakePrompter(),
      ids: { next: () => `operation-${++id}` },
    };
    const input = {
      paths: ['notes.md'],
      issue: 'g-1',
      title: 'Fixture contribution',
      cliVersion: '1.0.0',
      dryRun: false,
      yes: true,
      forceNew: false,
      posture: { readOnly: false, source: 'default' as const },
    };
    const created = await new PushSource(deps).execute(input);
    expect(created.action).toBe('create');
    expect(host.createdPullRequests).toHaveLength(1);
    expect(git(origin, 'show', `${created.commit}:notes.md`)).toBe('selected contribution');
    expect(git(origin, 'show', `${created.commit}:manifest/workspace.yaml`)).toBe(workspace);
    expect({
      head: git(source, 'rev-parse', 'HEAD'),
      index: readFileSync(path.join(source, '.git/index')),
      status: git(source, 'status', '--porcelain=v1'),
    }).toEqual(before);
    expect(
      await new PushSource({ ...deps, records: new FileContributionStore(home, lock) }).execute(
        input,
      ),
    ).toMatchObject({ action: 'unchanged', written: false });
    expect(host.createdPullRequests).toHaveLength(1);
    expect(
      readFileSync(path.join(home, 'workspaces/test/contributions.json'), 'utf8'),
    ).not.toContain('selected contribution');
  });
});
