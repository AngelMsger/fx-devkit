import { randomUUID } from 'node:crypto';
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { writeNodeShim, runtimeTools } from '../platform.js';

import { freshHome, fx, manifestDirOf, repository } from './harness.js';

function fixture() {
  const base = realpathSync(freshHome());
  const home = path.join(base, 'fx');
  const root = path.join(base, 'workspace');
  const bin = path.join(base, 'bin');
  for (const dir of [home, root, bin, path.join(base, 'hosts/team')])
    mkdirSync(dir, { recursive: true });
  repository(path.join(base, 'hosts/team'), 'example', { 'README.md': 'Example repository\n' });
  const source = manifestDirOf(home, 'test');
  mkdirSync(path.join(source, 'manifest'), { recursive: true });
  writeFileSync(
    path.join(home, 'config.yaml'),
    JSON.stringify({
      agents: ['claude-code', 'codex', 'gemini'],
      default_workspace: 'test',
      user: 'fixture',
      workspaces: { test: { root } },
    }),
  );
  writeFileSync(
    path.join(source, 'manifest/workspace.yaml'),
    JSON.stringify({
      schema_version: 2,
      providers: {
        'code-host': { provider: 'local-git', vars: { host: path.join(base, 'hosts') } },
      },
      defaults: { branch: 'main', upstream_project: 'team' },
      repos: [{ name: 'example', desc: 'Example repository' }],
    }),
  );
  writeFileSync(path.join(source, 'AGENTS.md'), 'Use fx to inspect workspace facts.\n');
  writeFileSync(
    path.join(source, 'manifest/harness.yaml'),
    JSON.stringify({
      schema_version: 2,
      mcp: [
        {
          name: 'local',
          transport: 'stdio',
          command: ['fx-fixture-mcp-server'],
          env: { FX_MCP_SENTINEL: { from_env: 'FX_MCP_SENTINEL' } },
          variables: { FX_MCP_SENTINEL: { instructions: 'Obtain team access.' } },
          check: { command: ['fx-fixture-mcp-check'], json: { path: 'ready', equals: true } },
        },
        {
          name: 'remote',
          transport: 'http',
          url: 'https://mcp.example.com/mcp',
          headers: { Authorization: { from_env: 'FX_MCP_SENTINEL' } },
          variables: { FX_MCP_SENTINEL: { instructions: 'Obtain team access.' } },
          check: { command: ['fx-fixture-mcp-check'], json: { path: 'ready', equals: true } },
        },
      ],
    }),
  );
  const serverMarker = path.join(base, 'server-started');
  writeNodeShim(
    bin,
    'fx-fixture-mcp-server',
    `#!${process.execPath}\nrequire('node:fs').writeFileSync(${JSON.stringify(serverMarker)},'started');\n`,
  );
  writeNodeShim(
    bin,
    'fx-fixture-mcp-check',
    `#!${process.execPath}\nprocess.stderr.write(process.env.FX_MCP_SENTINEL);process.stdout.write(JSON.stringify({ready:true}));\n`,
  );
  runtimeTools(bin);
  const secret = `opaque-${randomUUID()}`;
  return {
    base,
    home,
    root,
    source,
    serverMarker,
    secret,
    env: {
      FX_HOME: home,
      FX_MCP_SENTINEL: secret,
      PATH: bin,
      FX_TRACE: path.join(home, 'trace.jsonl'),
    },
  };
}
function assertAbsent(root: string, value: string) {
  for (const name of readdirSync(root)) {
    const file = path.join(root, name);
    const stat = lstatSync(file);
    if (stat.isDirectory()) assertAbsent(file, value);
    else if (stat.isFile())
      expect(readFileSync(file).includes(Buffer.from(value)), file).toBe(false);
  }
}

describe('harness acceptance', () => {
  it('keeps secrets out of full sync, readiness diagnostics, traces and all three native formats', () => {
    const f = fixture();
    const synced = fx(
      ['sync', '--no-refresh-manifest', '--yes', '--format', 'json'],
      f.env,
      f.root,
    );
    expect(synced.status, synced.stderr).toBe(0);
    expect(synced.json()).toMatchObject({ stages: { mcp: { created: 6 } } });
    for (const file of ['.mcp.json', '.gemini/settings.json', '.codex/config.toml'])
      expect(readFileSync(path.join(f.root, file), 'utf8')).toContain('FX_MCP_SENTINEL');
    for (const args of [
      ['can', 'mcp:local'],
      ['mcp', 'list'],
      ['mcp', 'show', 'remote'],
      ['doctor'],
    ]) {
      const result = fx([...args, '--format', 'json', '--verbose'], f.env, f.root);
      expect(result.status, result.stderr).toBe(0);
      expect(result.stdout + result.stderr).not.toContain(f.secret);
    }
    expect(existsSync(f.serverMarker)).toBe(false);
    assertAbsent(f.home, f.secret);
    assertAbsent(f.root, f.secret);
  });
  it('does not report an agent ready after its managed native entry was changed', () => {
    const f = fixture();
    expect(fx(['sync', '--only', 'mcp', '--yes', '--format', 'json'], f.env, f.root).status).toBe(
      0,
    );
    const file = path.join(f.root, '.mcp.json');
    writeFileSync(
      file,
      readFileSync(file, 'utf8').replace('fx-fixture-mcp-server', 'user-owned-server'),
    );
    const result = fx(
      ['can', 'mcp:local', '--agent', 'claude-code', '--format', 'json'],
      f.env,
      f.root,
    );
    expect(result.status, result.stderr).toBe(0);
    expect(result.json()).toMatchObject({
      status: 'unconfigured',
      projection: 'conflict',
      handoff: expect.any(Object),
    });
    expect(readFileSync(file, 'utf8')).toContain('user-owned-server');
  });
});
