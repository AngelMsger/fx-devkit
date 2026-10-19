import { describe, expect, it } from 'vitest';

import { FamilyCli, itemsOf, queryFailed } from '../../../src/adapters/family/cli.js';
import { FakeProcess } from '../../fakes/fake-process.js';

const cli = (proc: FakeProcess, context?: string): FamilyCli =>
  new FamilyCli('tool-cli', proc, context);

describe('FamilyCli', () => {
  it('keeps raw stdout and parses whatever JSON it carries, object or array', async () => {
    const proc = new FakeProcess()
      .on(['tool-cli', '--format', 'json', 'list'], { code: 0, stdout: '[1,2]', stderr: '' })
      .on(['tool-cli', '--format', 'json', 'raw'], { code: 0, stdout: 'v1\n', stderr: '' });
    const list = await cli(proc).call(['list']);
    expect(list.data).toEqual([1, 2]);
    expect(list.stdout).toBe('[1,2]');
    const raw = await cli(proc).call(['raw']);
    expect(raw.data).toBeUndefined();
    expect(raw.stdout).toBe('v1\n');
  });

  it('passes the timeout and the context through', async () => {
    const proc = new FakeProcess().always({ code: 0, stdout: '{}', stderr: '' });
    await cli(proc, 'work').call(['x'], { timeoutMs: 15_000 });
    expect(proc.soleCallTo(['tool-cli']).vector).toEqual([
      'tool-cli',
      '--format',
      'json',
      '--use-context',
      'work',
      'x',
    ]);
    expect(proc.soleCallTo(['tool-cli']).options.timeoutMs).toBe(15_000);
  });

  it('reads the error envelope from stderr after the notices', async () => {
    const proc = new FakeProcess().always({
      code: 9,
      stdout: '',
      stderr: '{"_notice":{"skill":{}}}\n{"error":{"category":"server","message":"boom"}}\n',
    });
    const call = await cli(proc).call(['x']);
    expect(call.error?.message).toBe('boom');
    expect(queryFailed('tool-cli', call, 'do x')).toMatchObject({
      category: 'server',
      code: 'PLATFORM_QUERY_FAILED',
    });
  });

  it('names a missing binary as a config error with the install steps', async () => {
    await expect(cli(new FakeProcess()).call(['x'])).rejects.toMatchObject({
      code: 'TOOL_MISSING',
      nextSteps: ['fx can tool-cli', 'fx tool install tool-cli'],
    });
  });

  it('leaves a tool that started and exited 127 to be read as a failed query', async () => {
    const proc = new FakeProcess().always({
      code: 127,
      stdout: '',
      stderr: 'helper executable unavailable\n',
    });
    const call = await cli(proc).call(['x']);
    expect(queryFailed('tool-cli', call, 'do x')).toMatchObject({
      category: 'server',
      code: 'PLATFORM_QUERY_FAILED',
      message: 'tool-cli could not do x: helper executable unavailable',
    });
  });

  it.each([
    { state: 'is missing', preview: { code: 0, stdout: '{"changed":true}', stderr: '' } },
    { state: 'conflicts', preview: { code: 11, stdout: '', stderr: '{}' } },
  ])('withholds authenticated queries when the target preset $state', async ({ preview }) => {
    const proc = new FakeProcess().on(['tool-cli', 'config'], preview);
    const client = new FamilyCli('tool-cli', proc, 'team', {
      base_url: 'https://git.example.com',
    });
    await expect(client.call(['whoami'])).rejects.toMatchObject({ code: 'LOGIN_REQUIRED' });
    expect(proc.calls.some((call) => call.vector.includes('whoami'))).toBe(false);
  });

  it('classifies a failed query by the family exit code', () => {
    const call = (code: number) => ({ code, stdout: '', data: undefined, error: undefined });
    expect(queryFailed('t', call(4), 'x')).toMatchObject({
      category: 'auth',
      code: 'PLATFORM_AUTH',
    });
    expect(queryFailed('t', call(5), 'x')).toMatchObject({
      category: 'permission',
      code: 'PLATFORM_FORBIDDEN',
    });
    expect(queryFailed('t', call(8), 'x').category).toBe('network');
    expect(queryFailed('t', call(7), 'x').category).toBe('rate_limit');
    expect(queryFailed('t', call(1), 'x').category).toBe('server');
  });

  it('reads items from the family envelope or a bare array, and refuses a list it cannot trust', () => {
    expect(itemsOf({ items: [{ a: 1 }], has_more: false })).toEqual([{ a: 1 }]);
    expect(itemsOf([{ b: 2 }])).toEqual([{ b: 2 }]);
    expect(itemsOf('nope')).toBeUndefined();
    expect(itemsOf({ items: [{ a: 1 }, 2] }), 'a row that is not a record').toBeUndefined();
    expect(itemsOf({ items: [], has_more: true }), 'a page left unread').toBeUndefined();
    expect(itemsOf({ items: [] }), 'an envelope that will not say').toBeUndefined();
  });
});
