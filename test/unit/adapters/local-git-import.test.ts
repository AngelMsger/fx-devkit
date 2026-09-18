import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { describe, expect, it } from 'vitest';

import { identifyLocalGitRemote } from '../../../src/adapters/code-host/local-git/import.js';
import { FakeProcess } from '../../fakes/fake-process.js';

const remote = path.resolve('/host/team/api.git');

describe('local Git provider evidence', () => {
  it.each([remote, pathToFileURL(remote).href])(
    'recognizes a verified bare repository: %s',
    async (url) => {
      const process = new FakeProcess().on(['git', '--git-dir', remote], {
        code: 0,
        stdout: 'true\n',
        stderr: '',
      });
      expect(await identifyLocalGitRemote(process, url)).toEqual({
        provider: 'local-git',
        host: path.resolve('/host'),
      });
    },
  );

  it('does not classify hosted URLs, relative paths or non-bare Git directories', async () => {
    const process = new FakeProcess().on(['git'], { code: 0, stdout: 'false\n', stderr: '' });
    for (const url of [
      'https://git.example.com/team/api.git',
      'git@git.example.com:team/api.git',
      '../api.git',
    ])
      expect(await identifyLocalGitRemote(process, url)).toBeUndefined();
    expect(process.calls).toEqual([]);
    expect(await identifyLocalGitRemote(process, remote)).toBeUndefined();
  });
});
