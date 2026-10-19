import { existsSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import { AutomaticSync } from '../../../../src/application/hook/automatic-sync.js';
import { createContainer } from '../../../../src/composition/container.js';
import { automaticSyncWiring } from '../../../../src/composition/hook-wiring.js';
import type { HookObservation, HookState } from '../../../../src/domain/harness/state.js';
import { FakeClock } from '../../../fakes/fake-clock.js';
import { tempDir } from '../../../temp.js';

describe('automatic workspace synchronization', () => {
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
  it('throttles failed refreshes while retrying local projections independently', async () => {
    let state: HookState | null = null;
    let refreshes = 0;
    let docs = 0;
    const clock = new FakeClock();
    const sync = new AutomaticSync({
      clock,
      lock: { acquire: async () => ({ release: async () => {} }) },
      state: {
        read: async () => state,
        write: async (_name, next) => {
          state = next;
        },
      },
      canWrite: async () => true,
      refresh: async () => {
        refreshes++;
        throw new Error('network');
      },
      docs: async () => {
        docs++;
        return [];
      },
      skills: async () => [],
      root: async () => [],
      checks: async () => [],
    });
    await sync.execute({ workspace: 'test', root: path.resolve('/workspace') });
    clock.advance(16000);
    await sync.execute({ workspace: 'test', root: path.resolve('/workspace') });
    expect(refreshes).toBe(1);
    expect(docs).toBe(2);
    expect(
      (state as HookState | null)?.observations.find((o) => o.code === 'MANIFEST_REFRESH_FAILED'),
    ).toMatchObject({ detail: 'INTERNAL: network' });
  });
  it('dates every phase it commits to, so a run killed mid-phase is not silent', async () => {
    let state: HookState | null = null;
    const clock = new FakeClock();
    const observation = (phase: string, code: string): HookObservation => ({
      phase,
      code,
      command: null,
      checkedAt: clock.now().getTime(),
    });
    const sync = new AutomaticSync({
      clock,
      lock: { acquire: async () => ({ release: async () => {} }) },
      state: {
        read: async () => state,
        write: async (_name, next) => {
          state = next;
        },
      },
      canWrite: async () => true,
      refresh: async () => [observation('manifest', 'MANIFEST_UP_TO_DATE')],
      docs: async () => [observation('docs', 'DOCS_CURRENT')],
      // The supervisor kills the worker group here; nothing later ever runs.
      skills: () => new Promise(() => {}),
      root: async () => [observation('root', 'ROOT_ACCOUNTED')],
      checks: async () => [observation('checks', 'LOGIN_CHECKED')],
    });
    void sync.execute({ workspace: 'test', root: path.resolve('/workspace') });
    await vi.waitFor(() =>
      expect(state?.observations.map((o) => o.code)).toContain('MANIFEST_UP_TO_DATE'),
    );
    await vi.waitFor(() =>
      expect(state?.observations.map((o) => o.code)).toContain('DOCS_CURRENT'),
    );
    expect(
      [...((state as HookState | null)?.observations ?? [])]
        .sort((a, b) => a.phase.localeCompare(b.phase))
        .map((o) => [o.phase, o.code, o.command]),
    ).toEqual([
      ['checks', 'HOOK_PHASE_UNREPORTED', 'fx doctor'],
      ['docs', 'DOCS_CURRENT', null],
      ['manifest', 'MANIFEST_UP_TO_DATE', null],
      ['root', 'ROOT_ACCOUNTED', null],
      ['skills', 'HOOK_PHASE_UNREPORTED', 'fx sync --only skills'],
    ]);
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
  it('derives rules under the existing workspace lease without starting MCP or trusting vectors', async () => {
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
    expect(lease).not.toBeNull();
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
      await wiring.docs(lease!);
      expect(readFileSync(path.join(root, 'GEMINI.md'), 'utf8')).toContain('AGENTS.md');
      expect(existsSync(path.join(root, '.gemini/settings.json'))).toBe(false);
      expect(existsSync(path.join(home, 'trust.yaml'))).toBe(false);
    } finally {
      await lease?.release();
    }
  });
});
