import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { identifyGitHubRemote } from '../../../src/adapters/code-host/github/import.js';
import { Import } from '../../../src/application/manifest/import.js';
import { loadWorkspace } from '../../../src/domain/manifest/loader.js';
import { FakeFs } from '../../fakes/fake-fs.js';
import { FakeGit } from '../../fakes/fake-git.js';
import { FakeReporter } from '../../fakes/fake-reporter.js';

describe('GitHub remotes in manifest import', () => {
  it('names the github provider for a remote on github.com, keeping its transport', () => {
    for (const url of ['https://github.com/team/api.git', 'https://github.com/team/api'])
      expect(identifyGitHubRemote(url)).toEqual({ provider: 'github', host: 'https://github.com' });
    for (const url of ['git@github.com:team/api.git', 'ssh://git@github.com/team/api.git'])
      expect(identifyGitHubRemote(url)).toEqual({
        provider: 'github',
        host: 'ssh://git@github.com',
      });
  });

  it('guesses nothing for another host, an enterprise server or an odd address', () => {
    for (const url of [
      'https://github.example.com/team/api.git',
      'git@github.example.com:team/api.git',
      'https://git.example.com/team/api.git',
      'https://github.com/team/group/api.git',
      'https://github.com:8443/team/api.git',
      'http://github.com/team/api.git',
      'ssh://someone@github.com/team/api.git',
      '/srv/git/team/api.git',
    ])
      expect(identifyGitHubRemote(url)).toBeUndefined();
  });

  it('binds the code host and folds the shared clone prefix into defaults', async () => {
    const root = path.normalize(path.resolve('/ws'));
    const fs = FakeFs.from({});
    const git = new FakeGit((dir) => fs.mkdir(dir));
    for (const name of ['api', 'web'])
      git.add(`${root}/${name}`, {
        remotes: { origin: `https://github.com/team/${name}.git` },
        remoteHeads: { origin: 'main' },
      });
    const out = await new Import({
      git,
      fs,
      reporter: new FakeReporter(),
      localCodeHost: () => {
        throw new Error('a GitHub host is not a local directory to ask');
      },
      identifyProvider: async (upstream) => identifyGitHubRemote(upstream),
    }).execute({ dir: root, dryRun: false, posture: { readOnly: false, source: 'default' } });
    const doc = loadWorkspace(out.manifest, { cliVersion: '1.0.0' }).doc;
    expect(doc.providers).toEqual({
      'code-host': { provider: 'github', vars: { host: 'https://github.com' } },
    });
    expect(doc.defaults).toMatchObject({ host: 'https://github.com', upstream_project: 'team' });
    expect(doc.repos).toEqual([{ name: 'api' }, { name: 'web' }]);
  });
});
