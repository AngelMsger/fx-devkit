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

  it.each([
    ['windsurf', '.codeium/windsurf/skills', '.windsurf/skills'],
    ['pi', '.pi/agent/skills', '.pi/skills'],
    ['opencode', '.config/opencode/skills', '.opencode/skills'],
  ])('names the Skill directories %s reads', (id, global, project) => {
    const irregular = AGENT_SPECS.find((s) => s.id === id)!;
    const deps = { fs: FakeFs.from({}), process: new FakeProcess(), home };
    const host = new SpecAgentHost(irregular, deps);
    const root = path.resolve('/ws');
    expect(host.skillsDir('global')).toBe(path.join(home, global));
    expect(host.skillsDir('project', root)).toBe(path.join(root, project));
  });

  it('describes codex as a host that forwards a variable under its own name only', () => {
    const codex = AGENT_SPECS.find((s) => s.id === 'codex')!;
    const deps = { fs: FakeFs.from({}), process: new FakeProcess(), home };
    expect(new SpecAgentHost(codex, deps).mcp).toMatchObject({
      status: 'supported',
      references: 'forward',
    });
  });
});
