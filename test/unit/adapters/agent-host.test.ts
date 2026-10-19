import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { SpecAgentHost } from '../../../src/adapters/agent-host/host.js';
import { AGENT_SPECS } from '../../../src/adapters/agent-host/specs.js';
import { FakeFs } from '../../fakes/fake-fs.js';
import { FakeProcess } from '../../fakes/fake-process.js';

describe('SpecAgentHost', () => {
  const spec = AGENT_SPECS.find((s) => s.id === 'claude-code')!;
  const home = path.normalize(path.resolve('/home/alice'));

  it('is detected by a marker directory or by a binary on PATH, and knows its skill dirs', async () => {
    const byDir = new SpecAgentHost(spec, {
      fs: FakeFs.from({ [`${home}/.claude/settings.json`]: '{}' }),
      process: new FakeProcess(),
      home,
    });
    expect(await byDir.detect()).toBe(true);
    const proc = new FakeProcess();
    proc.binaries.add('claude');
    const byBinary = new SpecAgentHost(spec, { fs: FakeFs.from({}), process: proc, home });
    expect(await byBinary.detect()).toBe(true);
    const neither = new SpecAgentHost(spec, {
      fs: FakeFs.from({}),
      process: new FakeProcess(),
      home,
    });
    expect(await neither.detect()).toBe(false);
    expect(neither.skillsDir('global')).toBe(path.join(home, '.claude', 'skills'));
    expect(neither.skillsDir('project', path.resolve('/ws'))).toBe(
      path.normalize(path.resolve('/ws/.claude/skills')),
    );
  });
});
