import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { JsonMcpCodec } from '../../../src/adapters/agent-host/json-mcp.js';
import { TomlMcpCodec } from '../../../src/adapters/agent-host/toml-mcp.js';
import type { McpProjectionSupport } from '../../../src/domain/harness/mcp.js';

const resource = {
  name: 'knowledge',
  transport: 'stdio' as const,
  command: ['server', 'serve'],
  env: { TOKEN: { from_env: 'TOKEN' } },
};
const nativeName = 'fx-knowledge';
const cases = [
  {
    codec: new JsonMcpCodec('linux'),
    support: {
      status: 'supported',
      protocol: 'json',
      projectPath: '.mcp.json',
      rootKey: 'mcpServers',
      references: 'interpolate',
    } as McpProjectionSupport,
    foreign: '{"other":{"keep":true},"mcpServers":{"foreign":{"command":"mine"}}}\n',
  },
  {
    codec: new JsonMcpCodec('linux'),
    support: {
      status: 'supported',
      protocol: 'jsonc',
      projectPath: '.gemini/settings.json',
      rootKey: 'mcpServers',
      references: 'interpolate',
    } as McpProjectionSupport,
    foreign:
      '{\n  // untouched comment\n  "other":  1,\n  "mcpServers": {"foreign":{"command":"mine"}}\n}\n',
  },
  {
    codec: new TomlMcpCodec('linux'),
    support: {
      status: 'supported',
      protocol: 'toml',
      projectPath: '.codex/config.toml',
      rootKey: 'mcp_servers',
      references: 'forward',
    } as McpProjectionSupport,
    foreign: '# untouched\nmodel = "example"\n[mcp_servers.foreign]\ncommand = "mine"\n',
  },
];

describe('MCP native codecs', () => {
  for (const { codec, support, foreign } of cases) {
    it(`${support.protocol} matches the reviewed native golden bytes`, () => {
      expect(
        codec.project({ current: null, support, name: nativeName, resource, owned: null }).text,
      ).toBe(readFileSync(`test/fixtures/harness/mcp.${support.protocol}`, 'utf8'));
    });
    it(`${support.protocol} preserves foreign content and requires receipt evidence for later edits`, () => {
      const input = { current: foreign, support, name: nativeName, resource, owned: null };
      const created = codec.project(input);
      expect(created.status).toBe('managed');
      expect(created.digest).not.toBeNull();
      const again = codec.project({ ...input, current: created.text, owned: created.digest });
      expect(again.text).toBe(created.text);
      expect(codec.project({ ...input, current: created.text }).status).toBe('foreign');
      const removed = codec.project({
        ...input,
        current: created.text,
        owned: created.digest,
        resource: null,
      });
      expect(removed.status).toBe('managed');
      expect(removed.text).toContain(
        support.protocol === 'toml' ? 'command = "mine"' : '"foreign":{"command":"mine"}',
      );
      if (support.protocol === 'toml') expect(removed.text).toBe(foreign);
    });
    it(`${support.protocol} rejects modified managed entries and leaves malformed text untouched`, () => {
      const input = { current: foreign, support, name: nativeName, resource, owned: null };
      const created = codec.project(input);
      const modified = created.text!.replace('"server"', '"changed"');
      expect(codec.project({ ...input, current: modified, owned: created.digest }).status).toBe(
        'conflict',
      );
      expect(codec.project({ ...input, current: 'broken [ { !' }).status).toBe('foreign');
    });
  }
  it('does not trust a TOML marker when extra fields were added outside its fragment', () => {
    const { codec, support, foreign } = cases[2]!;
    const created = codec.project({
      current: foreign,
      support,
      name: nativeName,
      resource,
      owned: null,
    });
    expect(
      codec.project({
        current: created.text + 'extra = "user"\n',
        support,
        name: nativeName,
        resource,
        owned: created.digest,
      }).status,
    ).toBe('conflict');
  });
  it('refuses duplicate JSON properties without selecting one of their values', () => {
    const { codec, support } = cases[0]!;
    const current = '{"mcpServers":{},"mcpServers":{}}';
    expect(
      codec.project({ current, support, name: nativeName, resource, owned: null }),
    ).toMatchObject({ status: 'foreign', text: current });
  });
});
