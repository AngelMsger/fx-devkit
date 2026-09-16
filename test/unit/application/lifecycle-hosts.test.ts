import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { AGENT_SPECS } from '../../../src/adapters/agent-host/specs.js';
import { createAgentHosts } from '../../../src/composition/registry.js';
import { BUILTIN_HOOKS } from '../../../src/domain/harness/hooks.js';
import { FakeFs } from '../../fakes/fake-fs.js';
import { FakeProcess } from '../../fakes/fake-process.js';

describe('lifecycle host registration', () => {
  const deps = { fs: new FakeFs(), process: new FakeProcess(), home: path.resolve('/home/test') };

  it('adds a host through data without changing discovery or its Skill routing', () => {
    const [host] = createAgentHosts(deps, [
      {
        id: 'sample',
        label: 'Sample',
        homeSub: '.sample',
        projectSkills: '.sample/skills',
        markers: [],
        projectMarkers: [],
        binaries: [],
        hooks: {
          projectPath: '.sample/hooks.json',
          protocol: 'sample',
          events: { 'session-start': 'Started' },
          context: 'native',
          identityEnvironment: [],
        },
      },
    ]);
    expect(host?.hooks?.events['session-start']).toBe('Started');
    expect(host?.skillsDir('project', path.resolve('/workspace'))).toBe(
      path.resolve('/workspace/.sample/skills'),
    );
  });

  it('distinguishes unsupported hosts from supported hosts without context delivery', () => {
    const hosts = createAgentHosts(deps);
    expect(hosts.find((h) => h.id === 'cursor')?.hooks).toBeNull();
    expect(hosts.find((h) => h.id === 'grok')?.hooks?.context).toBe('none');
    expect(hosts.filter((h) => h.hooks !== null).map((h) => h.id)).toEqual([
      'claude-code',
      'codex',
      'grok',
      'pi',
    ]);
    expect(AGENT_SPECS).toHaveLength(13);
  });

  it('registers only session-start behavior while reserving later events', () => {
    expect(BUILTIN_HOOKS.map((h) => h.event)).toEqual(['session-start']);
    expect(BUILTIN_HOOKS[0]?.command).toEqual(['fx', 'hook', 'dispatch', 'session-start']);
  });
});
