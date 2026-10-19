import { existsSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { createContainer } from '../../../src/composition/container.js';
import { automaticSyncWiring } from '../../../src/composition/hook-wiring.js';
import { tempDir } from '../../temp.js';

describe('the phases a background run is wired with', () => {
  it('does not describe an unconfigured manifest source as a static or current source', async () => {
    const home = tempDir('fx-source-observation-');
    const wiring = await automaticSyncWiring({
      container: createContainer({ FX_HOME: home }),
      request: {
        event: 'session-start',
        workspace: 'test',
        root: path.resolve('/workspace'),
        home,
        agent: 'codex',
        owner: 'fx:test',
      },
      env: {},
      canWrite: async () => true,
    });
    expect((await wiring.refresh())[0]?.code).toBe('MANIFEST_REFRESH_UNAVAILABLE');
  });
  it('observes what sits at the root outside the workbench, by name and without a lease', async () => {
    const home = realpathSync.native(tempDir('fx-background-root-'));
    const root = path.join(home, 'workspace');
    mkdirSync(path.join(root, '.workbench/tmp'), { recursive: true });
    mkdirSync(path.join(root, 'example'));
    writeFileSync(path.join(root, 'demo.html'), '<html>');
    const container = createContainer({ FX_HOME: home });
    const source = container.manifestDirFor('test');
    mkdirSync(path.join(source, 'manifest'), { recursive: true });
    writeFileSync(
      path.join(source, 'manifest/workspace.yaml'),
      'schema_version: 2\nproviders: {code-host: {provider: local-git, vars: {host: /tmp/example-hosts}}}\ndefaults: {branch: main}\nrepos: [{name: example, desc: Example}]\n',
    );
    await container.config.write({ workspaces: { test: { root } }, agents: ['gemini'] });
    const wiring = await automaticSyncWiring({
      container,
      request: {
        event: 'session-start',
        workspace: 'test',
        root,
        home,
        agent: 'gemini',
        owner: 'fx:test',
      },
      env: { FX_UPDATE_CHECK: '0' },
      canWrite: async () => true,
    });
    expect(await wiring.root()).toMatchObject([
      {
        phase: 'root',
        code: 'ROOT_STRAY',
        command: 'fx doctor',
        detail: '1 outside .workbench: demo.html',
      },
    ]);
    rmSync(path.join(root, 'demo.html'));
    expect((await wiring.root()).map((o) => [o.code, o.command])).toEqual([
      ['ROOT_ACCOUNTED', null],
    ]);
  });
  // A workspace whose harness declares an MCP server with a check, once the background
  // run has derived its documents under the workspace lease its caller already holds.
  async function backgroundDocs(): Promise<{ home: string; root: string }> {
    const home = realpathSync.native(tempDir('fx-background-rules-'));
    const root = path.join(home, 'workspace');
    mkdirSync(root);
    const container = createContainer({ FX_HOME: home });
    const source = container.manifestDirFor('test');
    mkdirSync(path.join(source, 'manifest'), { recursive: true });
    writeFileSync(
      path.join(source, 'manifest/workspace.yaml'),
      'schema_version: 2\nproviders: {code-host: {provider: local-git, vars: {host: /tmp/example-hosts}}}\ndefaults: {branch: main}\nrepos: [{name: example, desc: Example}]\n',
    );
    writeFileSync(
      path.join(source, 'manifest/harness.yaml'),
      'schema_version: 2\nmcp: [{name: knowledge, transport: stdio, command: [never-run-server], check: {command: [never-run-check]}}]\n',
    );
    writeFileSync(path.join(source, 'AGENTS.md'), 'Workspace guide.\n');
    await container.config.write({ workspaces: { test: { root } }, agents: ['gemini'] });
    const lease = await container.lock.acquire({ key: 'workspace:test', waitMs: 0 });
    if (lease === null) throw new Error('the workspace lease was not free');
    try {
      const wiring = await automaticSyncWiring({
        container,
        request: {
          event: 'session-start',
          workspace: 'test',
          root,
          home,
          agent: 'gemini',
          owner: 'fx:test',
        },
        env: { FX_UPDATE_CHECK: '0' },
        canWrite: async () => true,
      });
      await wiring.docs(lease);
    } finally {
      await lease.release();
    }
    return { home, root };
  }

  it('derives the rules file under the workspace lease it is handed', async () => {
    const { root } = await backgroundDocs();
    expect(readFileSync(path.join(root, 'GEMINI.md'), 'utf8')).toContain('AGENTS.md');
  });

  it('neither projects the declared MCP server nor records trust for it', async () => {
    const { home, root } = await backgroundDocs();
    expect(existsSync(path.join(root, '.gemini/settings.json'))).toBe(false);
    expect(existsSync(path.join(home, 'trust.yaml'))).toBe(false);
  });
});
