import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { AGENT_SPECS } from '../../../src/adapters/agent-host/specs.js';
import { hookProtocolFor } from '../../../src/composition/registry.js';

describe('native lifecycle protocols', () => {
  it('decodes Codex input without retaining prompt or transcript fields', () => {
    const support = AGENT_SPECS.find((s) => s.id === 'codex')!.hooks!;
    const codec = hookProtocolFor(support, 'linux');
    expect(
      codec.decode(
        JSON.stringify({
          cwd: '/workspace',
          session_id: 'session',
          prompt: 'secret',
          transcript_path: '/private/session',
        }),
        support,
      ),
    ).toEqual({ cwd: '/workspace', sessionId: 'session' });
    expect(codec.decode('{', support)).toBeNull();
    expect(codec.decode('{"cwd":42}', support)).toBeNull();
    expect(
      codec.project({
        current: '{"description":"user"}',
        owner: 'fx:test',
        event: 'SessionStart',
        vector: ['fx', 'hook', 'dispatch', 'session-start'],
        remove: false,
      }).text,
    ).toBe(readFileSync('test/fixtures/hooks/codex.txt', 'utf8').trimEnd());
  });
  it('projects the Claude entry exactly and encodes context for its native event', () => {
    const support = AGENT_SPECS.find((s) => s.id === 'claude-code')!.hooks!;
    const codec = hookProtocolFor(support, 'linux');
    expect(
      codec.project({
        current: '{}',
        owner: 'fx:test',
        event: 'SessionStart',
        vector: ['fx', 'hook', 'dispatch', 'session-start'],
        remove: false,
      }).text,
    ).toBe(readFileSync('test/fixtures/hooks/claude.txt', 'utf8').trimEnd());
    expect(JSON.parse(codec.context('state', support))).toEqual({
      hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: 'state' },
    });
  });
});
