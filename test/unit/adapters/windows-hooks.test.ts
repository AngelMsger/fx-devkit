import { spawnSync } from 'node:child_process';

import { describe, expect, it } from 'vitest';

import { JsonHookProtocol } from '../../../src/adapters/agent-host/json-hooks.js';
import { AGENT_SPECS } from '../../../src/adapters/agent-host/specs.js';
import { ownsWindowsHook } from '../../../src/adapters/process/powershell.js';
import { hookProtocolFor } from '../../../src/composition/registry.js';

const input = {
  current: null,
  owner: 'fx:test',
  event: 'SessionStart',
  vector: ['C:\\Program Files\\node.exe', 'C:\\中文 workspace\\fx.js'],
  remove: false,
};

describe('Windows hook projections', () => {
  it.each(['claude-code', 'codex', 'grok'])(
    'uses the native %s Windows protocol and migrates only owned hooks',
    (id) => {
      const support = AGENT_SPECS.find((host) => host.id === id)!.hooks!;
      const codec = hookProtocolFor(support, 'win32');
      const old = new JsonHookProtocol().project(input);
      const current = JSON.parse(old.text!);
      current.hooks.SessionStart[0].hooks.push({ type: 'command', command: 'user command' });
      const result = codec.project({ ...input, current: JSON.stringify(current) });
      const handlers = JSON.parse(result.text!).hooks.SessionStart[0].hooks;
      expect(handlers[1]).toEqual({ type: 'command', command: 'user command' });
      const native = handlers[0];
      expect(ownsWindowsHook(native.command, input.owner)).toBe(true);
      expect(ownsWindowsHook(native.command, 'fx:other')).toBe(false);
      expect(native.command).not.toContain('/dev/null');
      expect(native.shell).toBe(id === 'claude-code' ? 'powershell' : undefined);
      expect(native.commandWindows).toBe(id === 'codex' ? native.command : undefined);
      expect(codec.project({ ...input, current: result.text }).text).toBe(result.text);
      const removed = codec.project({ ...input, current: result.text, remove: true });
      expect(JSON.parse(removed.text!).hooks.SessionStart[0].hooks).toEqual([
        { type: 'command', command: 'user command' },
      ]);
    },
  );

  it.runIf(process.platform === 'win32')(
    'forwards UTF-8 input/output and suppresses a missing runtime',
    () => {
      const codec = new JsonHookProtocol('powershell');
      for (const vector of [
        ['C:\\missing-fx-runtime.exe'],
        [process.execPath, '-e', 'process.stdin.pipe(process.stdout)', '--'],
      ]) {
        const text = codec.project({ ...input, vector }).text!;
        const command = JSON.parse(text).hooks.SessionStart[0].hooks[0].command as string;
        const args = command.split(' ');
        const result = spawnSync(args[0]!, args.slice(1), {
          input: '中文\r\n',
          encoding: 'utf8',
          timeout: 5000,
        });
        expect(result.status, result.stderr).toBe(0);
        expect(result.stderr).toBe('');
        expect(result.stdout).toBe(vector.length === 1 ? '' : '中文\r\n');
      }
    },
  );
});
