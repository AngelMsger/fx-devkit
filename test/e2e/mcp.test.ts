import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { freshHome, fx, manifestDirOf } from './harness.js';

function fixture() {
  const home = freshHome();
  const root = path.join(home, 'workspace');
  const source = manifestDirOf(home, 'test');
  mkdirSync(root);
  mkdirSync(path.join(source, 'manifest'), { recursive: true });
  writeFileSync(
    path.join(home, 'config.yaml'),
    JSON.stringify({
      default_workspace: 'test',
      agents: ['claude-code'],
      workspaces: { test: { root } },
    }),
  );
  writeFileSync(
    path.join(source, 'manifest/workspace.yaml'),
    'schema_version: 2\nproviders: {code-host: {provider: local-git, vars: {host: /tmp/example-hosts}}}\ndefaults: {branch: main}\nrepos: [{name: example, desc: Example}]\n',
  );
  writeFileSync(
    path.join(source, 'manifest/harness.yaml'),
    JSON.stringify({
      schema_version: 2,
      mcp: [
        {
          name: 'knowledge',
          transport: 'stdio',
          command: ['fx-fixture-missing-server'],
          env: { TOKEN: { from_env: 'FX_MCP_TEST_TOKEN' } },
          variables: { FX_MCP_TEST_TOKEN: { instructions: 'Obtain workspace access.' } },
        },
      ],
    }),
  );
  return { home, root, env: { FX_HOME: home, FX_MCP_TEST_TOKEN: '' } };
}
describe('MCP can command', () => {
  it('returns a missing-tool handoff and suggests resource and host typos', () => {
    const f = fixture();
    const args = ['can', 'mcp:knowledge', '--format', 'json'];
    const result = fx(args, f.env, f.root);
    expect(result.status, result.stderr).toBe(0);
    expect(result.json()).toMatchObject({
      status: 'missing_tool',
      capability: 'mcp',
      resource: 'knowledge',
      handoff: { command: expect.any(String), user_steps: expect.any(Array) },
    });
    expect(fx(['can', 'mcp:knowledg', '--format', 'json'], f.env, f.root).error()).toMatchObject({
      code: 'MCP_UNKNOWN',
      hint: 'Did you mean "knowledge"?',
    });
    expect(fx([...args, '--agent', 'claud-code'], f.env, f.root).error().code).toBe(
      'AGENT_UNKNOWN',
    );
    expect(fx([...args, '--env', 'test'], f.env, f.root).error().code).toBe('MCP_ENV_UNSUPPORTED');
  });
  it('projects MCP through sync and reports the managed result in doctor', () => {
    const f = fixture();
    const env = { ...f.env, FX_MCP_TEST_TOKEN: 'synthetic-sensitive-value', FX_READ_ONLY: '0' };
    const preview = fx(['sync', '--only', 'mcp', '--dry-run', '--format', 'json'], env, f.root);
    expect(preview.status, preview.stderr).toBe(0);
    const synced = fx(['sync', '--only', 'mcp', '--yes', '--format', 'json'], env, f.root);
    expect(synced.status, synced.stderr).toBe(0);
    expect(synced.json()).toMatchObject({ stages: { mcp: { created: 1 } } });
    const report = fx(['doctor', '--format', 'json'], env, f.root);
    expect(report.status, report.stderr).toBe(0);
    expect(report.json()).toMatchObject({
      findings: expect.arrayContaining([expect.objectContaining({ group: 'mcp' })]),
    });
  });
  it('removes only owned MCP entries on unpick and preserves foreign rules on docs sync', () => {
    const f = fixture();
    const env = { ...f.env, FX_MCP_TEST_TOKEN: 'synthetic-sensitive-value' };
    expect(fx(['sync', '--only', 'mcp', '--yes', '--format', 'json'], env, f.root).status).toBe(0);
    const unpicked = fx(['agent', 'unpick', 'claude-code', '--format', 'json'], env, f.root);
    expect(unpicked.status, unpicked.stderr).toBe(0);
    expect(JSON.parse(readFileSync(path.join(f.root, '.mcp.json'), 'utf8')).mcpServers).toEqual({});
    writeFileSync(path.join(f.root, 'GEMINI.md'), 'User rules stay here.\n');
    const docs = fx(
      ['sync', '--only', 'docs', '--format', 'json'],
      { ...env, FX_AGENTS: 'gemini' },
      f.root,
    );
    expect(docs.status, docs.stderr).toBe(0);
    expect(readFileSync(path.join(f.root, 'GEMINI.md'), 'utf8')).toBe('User rules stay here.\n');
    expect(docs.json()).toMatchObject({
      stages: { docs: { rules_foreign: 1 } },
      stage_details: {
        docs: { rules: { items: [expect.objectContaining({ action: 'foreign' })] } },
      },
    });
    expect(docs.stdout).not.toContain('synthetic-sensitive-value');
  });
  it('lists and shows reference-only declarations with stable empty and populated JSON', () => {
    const f = fixture();
    const env = { ...f.env, FX_MCP_TEST_TOKEN: 'opaque-sensitive-value' };
    const listed = fx(['mcp', 'list', '--format', 'json'], env, f.root);
    expect(listed.status, listed.stderr).toBe(0);
    expect(listed.json()).toMatchObject({
      items: [{ name: 'knowledge', url: null, description: null }],
      has_more: false,
      orphaned: [],
    });
    expect(listed.stdout + listed.stderr).not.toContain('opaque-sensitive-value');
    const shown = fx(['mcp', 'show', 'knowledge', '--format', 'json'], env, f.root);
    expect(shown.status, shown.stderr).toBe(0);
    expect(shown.json()).toMatchObject({
      name: 'knowledge',
      env: { TOKEN: { from_env: 'FX_MCP_TEST_TOKEN' } },
      readiness: { status: 'missing_tool' },
    });
    rmSync(path.join(manifestDirOf(f.home, 'test'), 'manifest/harness.yaml'));
    expect(fx(['mcp', 'list', '--format', 'json'], env, f.root).json()).toMatchObject({
      items: [],
      has_more: false,
      orphaned: [],
    });
  });
});
