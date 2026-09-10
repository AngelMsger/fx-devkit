import { describe, expect, it } from 'vitest';

import { JenkinsCi } from '../../../src/adapters/ci/jenkins-cli/ci.js';
import { kubectlProvider } from '../../../src/adapters/cluster/kubectl/provider.js';
import { openobserveCliProvider } from '../../../src/adapters/log-store/openobserve-cli/provider.js';
import { FakeClock } from '../../fakes/fake-clock.js';
import { FakeFs } from '../../fakes/fake-fs.js';
import { FakeProcess } from '../../fakes/fake-process.js';

const deps = { process: new FakeProcess(), fs: new FakeFs(), clock: new FakeClock() };

describe('probe target identity', () => {
  it('asks for the named namespace instead of accepting a successful empty collection listing', () => {
    const probe = kubectlProvider
      .create(deps, {})
      .probe?.({ kubeconfig: 'config', context: 'dev', namespace: '--help' });
    expect(probe?.command).toEqual([
      'kubectl',
      '--kubeconfig',
      'config',
      '--context',
      'dev',
      'get',
      'namespace',
      '--',
      '--help',
    ]);
  });
  it('keeps flag-looking job and stream names as positional identifiers', () => {
    expect(new JenkinsCi(deps.process).probe({ path: '--help', context: 'dev' })?.command).toEqual([
      'jenkins-cli',
      'job',
      'get',
      '--use-context',
      'dev',
      '--',
      '--help',
    ]);
    expect(
      openobserveCliProvider.create(deps, {}).probe?.({ stream: '--help', context: 'dev' })
        ?.command,
    ).toEqual(['openobserve-cli', 'stream', 'get', '--use-context', 'dev', '--', '--help']);
  });
});
