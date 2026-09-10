import { spawnSync } from 'node:child_process';

import { describe, expect, it } from 'vitest';

import { JsonHookProtocol } from '../../../src/adapters/agent-host/json-hooks.js';

const protocol = new JsonHookProtocol();
const input = {
  owner: 'fx:test:session-start',
  event: 'SessionStart',
  vector: ['fx', 'hook', 'dispatch', 'session-start'],
  remove: false,
};

describe('managed JSON hook edits', () => {
  // POSIX wrapper contract; Windows wrapper execution is covered separately.
  it.skipIf(process.platform === 'win32')(
    'does not fail the host when the projected executable has disappeared',
    () => {
      const result = protocol.project({ ...input, current: null, vector: ['/missing-fx-runtime'] });
      const command = JSON.parse(result.text!).hooks.SessionStart[0].hooks[0].command;
      const ran = spawnSync('/bin/sh', ['-c', command], { encoding: 'utf8' });
      expect(ran.status).toBe(0);
      expect(ran.stdout).toBe('');
      expect(ran.stderr).toBe('');
    },
  );
  it('removes adjacent owned handlers without touching user additions to the group', () => {
    const added = protocol.project({ ...input, current: null });
    const handler = JSON.parse(added.text!).hooks.SessionStart[0].hooks[0];
    const current = JSON.stringify({
      hooks: {
        SessionStart: [
          { note: 'user', hooks: [handler, handler, { type: 'command', command: 'user' }] },
        ],
      },
    });
    const removed = protocol.project({ ...input, current, remove: true });
    expect(JSON.parse(removed.text!)).toEqual({
      hooks: { SessionStart: [{ note: 'user', hooks: [{ type: 'command', command: 'user' }] }] },
    });
    expect(protocol.project({ ...input, current: null, remove: true }).text).toBeNull();
  });
  it('preserves unrelated fields and hooks byte for byte, including CRLF and escapes', () => {
    const foreign = '{ "type" : "command", "command" : "echo \\u0061" }';
    const current = `{\r\n "custom" : 1e2, "hooks": {"SessionStart": [{"hooks":[${foreign}]}]}\r\n}\r\n`;
    const added = protocol.project({ ...input, current });
    expect(added.status).toBe('managed');
    expect(added.text).toContain(foreign);
    expect(added.text).toContain('"custom" : 1e2');
    const again = protocol.project({ ...input, current: added.text });
    expect(again.text).toBe(added.text);
    const removed = protocol.project({ ...input, current: added.text, remove: true });
    expect(removed.text).toBe(current);
  });

  it('refuses malformed documents and duplicate keys without rewriting them', () => {
    for (const current of ['{', '{"hooks":{},"hooks":{}}', '{"hooks":42}', '[]']) {
      expect(protocol.project({ ...input, current })).toEqual({ text: current, status: 'invalid' });
    }
  });

  it('quotes every vector argument as data, including shell metacharacters', () => {
    const result = protocol.project({
      ...input,
      current: null,
      vector: ['fx', "a'b", '$(touch /tmp/no)', '`echo no`'],
    });
    const parsed = JSON.parse(result.text!);
    expect(parsed.hooks.SessionStart[0].hooks[0].command).toBe(
      "'fx' 'a'\\''b' '$(touch /tmp/no)' '`echo no`' '--owner' 'fx:test:session-start' 2>/dev/null || :",
    );
  });
});
