import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import ts from 'typescript';
import { describe, expect, it } from 'vitest';

import { AGENT_SPECS } from '../../../src/adapters/agent-host/specs.js';
import { hookProtocolFor } from '../../../src/composition/registry.js';

describe('extension lifecycle bridge', () => {
  it('executes the generated bridge and delivers context without starting a new turn', async () => {
    const codec = hookProtocolFor(support);
    const script =
      "const b=Buffer.from(JSON.stringify({context:'中'}));process.stdout.write(b.subarray(0,13));setTimeout(()=>process.stdout.write(b.subarray(13)),20)";
    const out = codec.project({ ...input, vector: [process.execPath, '-e', script, '--'] });
    const js = ts.transpileModule(out.text!, {
      compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
    }).outputText;
    const temporary = mkdtempSync(path.join(tmpdir(), 'fx-bridge-'));
    const file = path.join(temporary, 'bridge.mjs');
    writeFileSync(file, js);
    try {
      const loaded = await import(/* @vite-ignore */ pathToFileURL(file).href);
      let callback: ((event: unknown, ctx: { cwd: string }) => Promise<void>) | undefined;
      const messages: unknown[] = [];
      loaded.default({
        on: (event: string, handler: typeof callback) => {
          if (event === 'session_start') callback = handler;
        },
        sendMessage: (message: unknown, options: unknown) => {
          messages.push({ message, options });
        },
      });
      expect(messages).toEqual([]);
      await callback?.({}, { cwd: process.cwd() });
      expect(messages).toEqual([
        {
          message: { customType: 'fx-workspace', content: '中', display: false },
          options: { triggerTurn: false },
        },
      ]);
    } finally {
      rmSync(temporary, { recursive: true, force: true });
    }
  });
  const support = AGENT_SPECS.find((s) => s.id === 'pi')!.hooks!;
  const input = {
    current: null,
    owner: 'fx:test',
    event: 'session_start',
    vector: ['fx', 'hook', 'dispatch', 'session-start', '--agent', 'pi'],
    remove: false,
  };
  it('generates only a bounded dispatch bridge and preserves foreign extensions', () => {
    const codec = hookProtocolFor(support);
    const out = codec.project(input);
    expect(out.text).toBe(readFileSync('test/fixtures/hooks/pi.txt', 'utf8'));
    expect(out.text?.startsWith('// fx:derived fx:test\n')).toBe(true);
    expect(out.text).toContain('triggerTurn: false');
    expect(out.text).not.toContain('fetch(');
    expect(codec.project({ ...input, current: '// user extension' })).toEqual({
      text: '// user extension',
      status: 'foreign',
    });
    expect(codec.project({ ...input, current: out.text, remove: true }).text).toBeNull();
    expect(JSON.parse(codec.context('state', support))).toEqual({ context: 'state' });
  });
});
