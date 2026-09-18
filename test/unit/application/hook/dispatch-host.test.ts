import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { resolveHookHost } from '../../../../src/application/hook/dispatch-host.js';
import { createAgentHosts, hookProtocolFor } from '../../../../src/composition/registry.js';
import { FakeFs } from '../../../fakes/fake-fs.js';
import { FakeProcess } from '../../../fakes/fake-process.js';

describe('actual hook host identity', () => {
  const hosts = createAgentHosts({
    fs: new FakeFs(),
    process: new FakeProcess(),
    home: path.resolve('/home/test'),
  });
  it('skips a compatible foreign entry when the native host identifies itself', () => {
    expect(resolveHookHost(hosts, 'claude-code', { GROK_HOOK_EVENT: 'session_start' })).toBeNull();
    const host = resolveHookHost(hosts, 'grok', { GROK_HOOK_EVENT: 'session_start' });
    expect(host?.id).toBe('grok');
    const support = host!.hooks!;
    const codec = hookProtocolFor(support, 'linux');
    expect(
      codec.project({
        current: null,
        owner: 'fx:test',
        event: 'SessionStart',
        vector: ['fx', 'hook', 'dispatch', 'session-start'],
        remove: false,
      }).text,
    ).toBe(readFileSync('test/fixtures/hooks/grok.txt', 'utf8').trimEnd());
    expect(codec.context('state', support)).toBe('');
    expect(codec.decode('{"cwd":"/workspace","sessionId":"session"}', support)?.sessionId).toBe(
      'session',
    );
  });
});
