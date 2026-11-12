import { describe, expect, it } from 'vitest';

import { DeadlineProcess } from '../../../src/adapters/process/deadline-process.js';
import { createContainer, workspaceDeps } from '../../../src/composition/container.js';
import { FakeProcess } from '../../fakes/fake-process.js';
import { harness } from '../../fakes/workspace.js';
import { tempDir } from '../../temp.js';

const home = tempDir('fx-container-');

describe('a decorated process port', () => {
  it('uses native Git authentication for explicit Bitbucket URLs without a provider binding', async () => {
    const ok = { code: 0, stdout: '', stderr: '' };
    const process = new FakeProcess()
      .on(['bitbucket-cli', 'git', '--help'], { ...ok, stdout: '--fallback' })
      .on(['bitbucket-cli', 'git', '--fallback'], ok);
    process.binaries.add('bitbucket-cli');
    const container = createContainer({ FX_HOME: home }, { decorateProcess: () => process });
    const fixture = await harness({
      workspace: `schema_version: 2
defaults: { branch: main }
repos:
  - name: repo
    upstream: ssh://git@git.example.com/TEAM/repo.git
`,
    });
    const deps = workspaceDeps(container, {
      ctx: fixture.ctx,
      reporter: fixture.reporter,
      cliVersion: '1.0.0',
      user: undefined,
      commandShell: undefined,
      noInput: true,
      yes: false,
      posture: { readOnly: false, source: 'default' },
    });
    await deps.git.clone({
      dir: '/work/repo',
      upstream: 'ssh://git@git.example.com/TEAM/repo.git',
      branch: 'main',
    });
    expect(process.calledWith(['bitbucket-cli', 'git', '--fallback', '--', 'clone'])).toBe(true);
    expect(process.callsTo(['git', 'clone'])).toHaveLength(0);
  });

  it('bounds the commands of members that were built on the port', async () => {
    const inner = new FakeProcess().always({ code: 1, stdout: '', stderr: '' });
    const bounded = createContainer(
      { FX_HOME: home },
      {
        decorateProcess: () => new DeadlineProcess(inner, { totalMs: 60_000, commandMs: 500 }),
      },
    );
    await bounded.registryLocator.resolve(bounded.packageMetadata().name);
    await bounded.git.toplevel(home);
    expect(inner.soleCallTo(['npm', 'config', 'get']).options).toMatchObject({
      interactive: false,
      timeoutMs: 500,
    });
    expect(inner.soleCallTo(['git']).options).toMatchObject({ interactive: false });
  });
});
