// Reference capabilities must prove readiness without running their business
// entry; manifest values stay arguments and unknown bindings stay errors.

import { describe, expect, it } from 'vitest';

import { Can } from '../../../src/application/can.js';
import { describeProvider, resolveProvider } from '../../../src/composition/registry.js';
import type { Coordinate } from '../../../src/domain/obs/types.js';
import { FakeClock } from '../../fakes/fake-clock.js';
import { fakeLoginDeps } from '../../fakes/fake-login-deps.js';
import { harness } from '../../fakes/workspace.js';

async function stage(capability: string, provider: string, vars: Record<string, string>) {
  const h = await harness({
    workspace: JSON.stringify({
      schema_version: 2,
      providers: { [capability]: { provider, vars } },
      repos: [
        { name: 'sample', branch: 'main', upstream: 'https://git.example.com/team/sample.git' },
      ],
    }),
  });
  const descriptor = describeProvider(provider);
  const login = fakeLoginDeps(descriptor === undefined ? {} : { [provider]: descriptor });
  const deps = {
    ...h.deps,
    reference: (binding: Parameters<typeof h.deps.reference>[0]) =>
      resolveProvider<Coordinate>(binding, {
        process: h.process,
        fs: h.fs,
        clock: new FakeClock(),
      }),
  };
  if (descriptor !== undefined) {
    const tool = descriptor.tools[0]!;
    h.process.binaries.add(tool);
    h.process.when((v) => v[1] === '--version', { code: 0, stdout: '9.0.0', stderr: '' });
  }
  return { h, can: new Can(deps, login) };
}

describe('workspace reference providers', () => {
  it('requires authenticated true before Meegle is ready and only prints the project query', async () => {
    const s = await stage('issue-tracker', 'feishu-project', {
      project_key: 'team; echo injected',
    });
    const auth = ['meegle', 'auth', 'status', '--format', 'json'];
    const authResult = { code: 0, stdout: '{"authenticated":false}', stderr: '' };
    s.h.process.on(auth, authResult);
    expect(await s.can.execute({ target: 'issue-tracker' })).toMatchObject({
      status: 'unconfigured',
      entry: { command: "meegle project search --project-key 'team; echo injected' --format json" },
    });
    authResult.stdout = '{"authenticated":true}';
    expect((await s.can.execute({ target: 'issue-tracker' })).status).toBe('ready');
    expect(s.h.process.calls.some((c) => c.vector[1] === 'project')).toBe(false);
    expect(s.h.localStore.writes).toEqual([]);
  });

  it('checks the declared Confluence space instead of accepting stored credentials alone', async () => {
    const s = await stage('knowledge-base', 'confluence', {
      base_url: 'https://wiki.example.com',
      space: 'TEAM',
    });
    const query = [
      'confluence-cli',
      'space',
      'get',
      'TEAM',
      '--base-url',
      'https://wiki.example.com',
      '--format',
      'json',
      '--fields',
      'key',
    ];
    const accessResult = { code: 5, stdout: '', stderr: 'access denied' };
    s.h.process.on(query, accessResult);
    expect((await s.can.execute({ target: 'knowledge-base' })).status).toBe('unconfigured');
    Object.assign(accessResult, { code: 0, stdout: '{"key":"TEAM"}', stderr: '' });
    expect(await s.can.execute({ target: 'knowledge-base' })).toMatchObject({
      status: 'ready',
      entry: { url: 'https://wiki.example.com' },
    });
  });

  it('verifies Lark user access with one group metadata query and never reads messages', async () => {
    const s = await stage('im', 'lark', {});
    const query = [
      'lark-cli',
      'im',
      '+chat-list',
      '--as',
      'user',
      '--types',
      'group',
      '--page-size',
      '1',
      '--format',
      'json',
    ];
    const result = { code: 5, stdout: '', stderr: 'missing scope' };
    s.h.process.on(query, result);
    expect((await s.can.execute({ target: 'im' })).status).toBe('unconfigured');
    Object.assign(result, { code: 0, stdout: '{"chats":[]}', stderr: '' });
    expect(await s.can.execute({ target: 'im' })).toMatchObject({
      status: 'ready',
      entry: { command: expect.stringContaining('--as user') },
    });
    expect(
      s.h.process.calls.every(
        (c) => c.vector[1] === '--version' || JSON.stringify(c.vector) === JSON.stringify(query),
      ),
    ).toBe(true);
  });

  it('rejects a WeCom API error even with exit zero and only checks session metadata', async () => {
    const s = await stage('im', 'wecom', {});
    const query = ['wecom-cli', 'message', 'aibot', 'sessions', 'list'];
    const result = { code: 0, stdout: '{"errcode":40001}', stderr: '' };
    s.h.process.on(query, result);
    expect((await s.can.execute({ target: 'im' })).status).toBe('unconfigured');
    result.stdout = '{"errcode":0,"results_json":{}}';
    expect(await s.can.execute({ target: 'im' })).toMatchObject({
      status: 'ready',
      entry: { command: query.join(' ') },
    });
    expect(
      s.h.process.calls.every(
        (c) => c.vector[1] === '--version' || JSON.stringify(c.vector) === JSON.stringify(query),
      ),
    ).toBe(true);
    expect(s.h.localStore.writes).toEqual([]);
  });

  it('needs a stored WeCom CalDAV credential and neither syncs nor reads the calendar mirror', async () => {
    const s = await stage('calendar', 'wecom-calendar-cli', {});
    const status = ['wecom-calendar-cli', 'auth', 'status', '--format', 'json'];
    const result = { code: 0, stdout: '{"configured":false,"detail":"no credential"}', stderr: '' };
    s.h.process.on(status, result);
    expect((await s.can.execute({ target: 'calendar' })).status).toBe('unconfigured');
    result.stdout = '{"configured":true,"username":"member@example.com"}';
    expect(await s.can.execute({ target: 'calendar' })).toMatchObject({
      status: 'ready',
      entry: { command: 'wecom-calendar-cli event list --format json' },
    });
    expect(
      s.h.process.calls.every(
        (c) => c.vector[1] === '--version' || JSON.stringify(c.vector) === JSON.stringify(status),
      ),
    ).toBe(true);
    expect(s.h.localStore.writes).toEqual([]);
  });

  it('requires a Tencent Meeting query to succeed, since its status command exits zero when signed out', async () => {
    const s = await stage('meeting', 'tencent-meeting', {});
    const query = ['tmeet', 'meeting', 'list', '--page-size', '1'];
    const result = { code: 1, stdout: '', stderr: 'Error: user config is empty' };
    s.h.process.on(query, result);
    expect(await s.can.execute({ target: 'meeting' })).toMatchObject({
      status: 'unconfigured',
      handoff: { user_steps: [{ command: ['tmeet', 'auth', 'login'] }] },
    });
    Object.assign(result, { code: 0, stdout: '{"message":"success"}', stderr: '' });
    expect(await s.can.execute({ target: 'meeting' })).toMatchObject({
      status: 'ready',
      entry: { command: 'tmeet meeting list' },
    });
    expect(
      s.h.process.calls.every(
        (c) => c.vector[1] === '--version' || JSON.stringify(c.vector) === JSON.stringify(query),
      ),
    ).toBe(true);
    expect(s.h.localStore.writes).toEqual([]);
  });

  it('rejects missing variables and unknown providers before readiness can be claimed', async () => {
    const missing = await stage('issue-tracker', 'feishu-project', { project_key: ' ' });
    await expect(missing.can.execute({ target: 'issue-tracker' })).rejects.toMatchObject({
      code: 'PROVIDER_VAR_MISSING',
    });
    expect(missing.h.process.calls).toEqual([]);
    const unknown = await stage('issue-tracker', 'meegle', {});
    await expect(unknown.can.execute({ target: 'issue-tracker' })).rejects.toMatchObject({
      code: 'PROVIDER_UNKNOWN',
    });
  });
});
