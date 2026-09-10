import { describe, expect, it } from 'vitest';

import { KEYS } from '../../../src/application/config/keys.js';
import { findKey, resolveKey } from '../../../src/application/config/resolve.js';

describe('resolveKey', () => {
  it('lets flag beat env beat file beat default, and reports every layer', () => {
    const r = resolveKey('format', {
      flag: 'json',
      env: { FX_FORMAT: 'ndjson' },
      file: { format: 'human' },
    });
    expect(r.value).toBe('json');
    expect(r.source).toBe('flag');
    expect(r.layers.map((l) => [l.source, l.value])).toEqual([
      ['flag', 'json'],
      ['env', 'ndjson'],
      ['file', 'human'],
      ['default', 'human'],
    ]);
  });

  it('falls through to the documented default', () => {
    expect(resolveKey('format', { env: {}, file: {} })).toMatchObject({
      value: 'human',
      source: 'default',
    });
  });

  it('reports an unset key without a default as absent', () => {
    expect(resolveKey('user', { env: {}, file: {} })).toMatchObject({
      value: undefined,
      source: 'default',
    });
  });

  it('renders list and boolean file values as their command-line spelling', () => {
    expect(
      resolveKey('agents', { env: {}, file: { agents: ['claude-code', 'codex'] } }).value,
    ).toBe('claude-code,codex');
    expect(resolveKey('read_only', { env: {}, file: { read_only: true } }).value).toBe('true');
  });
});

describe('findKey', () => {
  it('suggests the nearest key name for a typo', () => {
    expect(() => findKey('formt')).toThrow(
      expect.objectContaining({
        code: 'CONFIG_KEY_UNKNOWN',
        hint: expect.stringContaining('format'),
      }),
    );
  });

  it('registers every supported key with an env name and a description', () => {
    expect(KEYS.map((k) => k.name)).toEqual([
      'command_shell',
      'hooks',
      'default_workspace',
      'user',
      'format',
      'agents',
      'read_only',
      'skill_notice',
      'update_check',
    ]);
    for (const key of KEYS) {
      expect(key.env).toMatch(/^FX_[A-Z_]+$/);
      expect(key.desc.length).toBeGreaterThan(0);
    }
  });
});
