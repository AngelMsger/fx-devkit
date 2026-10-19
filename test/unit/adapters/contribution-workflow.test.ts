import { mkdirSync, realpathSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { SystemClock } from '../../../src/adapters/clock/system-clock.js';
import { NodeFs } from '../../../src/adapters/fs/node-fs.js';
import { SnapshotReader } from '../../../src/adapters/fs/snapshot-reader.js';
import { ContributionSystemGit } from '../../../src/adapters/git/contribution-system-git.js';
import { ContributionGitTransport } from '../../../src/adapters/git/contribution-transport.js';
import { NodeProcess } from '../../../src/adapters/process/node-process.js';
import { PushSource } from '../../../src/application/contribution/push.js';
import { ValidateContribution } from '../../../src/application/contribution/validate.js';
import { bundledToolsText } from '../../../src/composition/bundled.js';
import { providerCatalog } from '../../../src/composition/registry.js';
import { FileContributionStore } from '../../../src/infra/contribution-store.js';
import { FileLock } from '../../../src/infra/lock.js';
import { FakeCodeHost } from '../../fakes/fake-code-host.js';
import { FakeConfigStore } from '../../fakes/fake-config-store.js';
import { FakePrompter } from '../../fakes/fake-prompter.js';
import { committedBytes, git } from '../../git.js';
import { tempDir } from '../../temp.js';

describe('native contribution workflow with a durable journal', () => {
  it('validates only the candidate and can reload its completed operation without another push', async () => {
    const home = realpathSync.native(tempDir('fx-contribution-workflow-'));
    const source = path.join(home, 'workspaces/test/source');
    mkdirSync(path.join(source, 'manifest'), { recursive: true });
    git(['init', '-q', '-b', 'main'], source);
    git(['config', 'user.name', 'Fixture'], source);
    git(['config', 'user.email', 'fixture@example.com'], source);
    const workspace =
      'schema_version: 2\nproviders:\n  code-host: { provider: local-git, vars: { host: https://git.example.com } }\ndefaults: { branch: main }\nrepos: [{ name: example, desc: Example repository }]\n';
    writeFileSync(path.join(source, 'manifest/workspace.yaml'), workspace);
    writeFileSync(path.join(source, 'notes.md'), 'base');
    git(['add', '--', 'manifest/workspace.yaml', 'notes.md'], source);
    git(['commit', '-qm', 'initial'], source);
    const upstream = path.join(home, 'TEAM/manifest.git');
    const origin = path.join(home, '~alice/manifest.git');
    mkdirSync(path.dirname(upstream));
    mkdirSync(path.dirname(origin));
    git(['clone', '--bare', '-q', source, upstream], source);
    git(['clone', '--bare', '-q', upstream, origin], source);
    git(['remote', 'add', 'upstream', upstream], source);
    git(['remote', 'add', 'origin', origin], source);
    writeFileSync(path.join(source, 'notes.md'), 'selected contribution');
    writeFileSync(path.join(source, 'manifest/workspace.yaml'), 'unrelated broken YAML: [');
    const before = {
      head: git(['rev-parse', 'HEAD'], source),
      index: readFileSync(path.join(source, '.git/index')),
      status: git(['status', '--porcelain=v1'], source),
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
        bundledToolsText,
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
    expect(git(['show', `${created.commit}:notes.md`], origin)).toBe('selected contribution');
    expect(committedBytes(`${created.commit}:manifest/workspace.yaml`, origin)).toEqual(
      Buffer.from(workspace),
    );
    expect({
      head: git(['rev-parse', 'HEAD'], source),
      index: readFileSync(path.join(source, '.git/index')),
      status: git(['status', '--porcelain=v1'], source),
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
