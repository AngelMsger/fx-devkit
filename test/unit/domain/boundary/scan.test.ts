import { describe, expect, it } from 'vitest';

import { scanBoundary } from '../../../../src/domain/boundary/scan.js';

const internal = ['service', 'internal'].join('.');
const email = ['person', internal].join('@');
const credential = ['ghp_', 'a'.repeat(36)].join('');

describe('boundary scanning', () => {
  it('allows internal addresses in manifest contributions but rejects them in distributables', () => {
    const text = `endpoint: https://${internal}/api`;
    expect(scanBoundary({ text, policy: 'manifest' })).toEqual([]);
    expect(scanBoundary({ text, policy: 'distributable' })).toEqual([
      { rule: 'internal-address', line: 1, column: 19 },
    ]);
  });
  it('rejects credentials under either policy without returning their value', () => {
    for (const policy of ['manifest', 'distributable'] as const) {
      const result = scanBoundary({ text: `safe\ntoken: ${credential}`, policy });
      expect(result.some((item) => item.rule === 'credential' && item.line === 2)).toBe(true);
      expect(JSON.stringify(result)).not.toContain(credential);
    }
  });
  it.each([
    'password: a-secret-value',
    'api_key = "some-secret"',
    'Authorization: Bearer opaque-value',
    'https://user:password@example.com',
    ['-----BEGIN ', 'PRIVATE KEY-----'].join(''),
  ])('rejects credential form %s', (text) => {
    expect(
      scanBoundary({ text, policy: 'manifest' }).some((item) => item.rule === 'credential'),
    ).toBe(true);
  });
  it('rejects a secret mixed with a variable reference', () => {
    expect(scanBoundary({ text: 'password: prefix${PASSWORD}', policy: 'manifest' })[0]?.rule).toBe(
      'credential',
    );
  });
  it('distinguishes source identifiers from hardcoded source values', () => {
    const syntax = 'code' as const;
    expect(
      scanBoundary({
        text: 'const token = randomUUID(); this.local = local;',
        policy: 'distributable',
        syntax,
      }),
    ).toEqual([]);
    expect(
      scanBoundary({ text: 'const token = "a-secret-value";', policy: 'distributable', syntax })[0]
        ?.rule,
    ).toBe('credential');
  });
  it('keeps variable references and documentation placeholders unresolved', () => {
    const text =
      'token: ${SERVICE_TOKEN}\npassword: $PASSWORD\napi_key: "<your-key>"\nurl: https://example.com\ncontact: user@example.com';
    expect(scanBoundary({ text, policy: 'manifest' })).toEqual([]);
    expect(scanBoundary({ text, policy: 'distributable' })).toEqual([]);
  });
  it('rejects personnel markers and non-example emails for both targets', () => {
    const result = scanBoundary({
      text: `sensitive: true\npeople: []\nemail: ${email}`,
      policy: 'manifest',
    });
    expect(result.map((item) => item.rule)).toEqual(['personnel', 'personnel', 'email']);
  });
  it('detects private IPs and supplied internal hosts without embedding a company name', () => {
    const ip = [10, 2, 3, 4].join('.');
    const host = ['private', 'example.com'].join('.');
    expect(scanBoundary({ text: `https://${ip}`, policy: 'distributable' })[0]?.rule).toBe(
      'internal-address',
    );
    expect(
      scanBoundary({ text: `https://${host}`, policy: 'distributable', internalHosts: [host] })[0]
        ?.rule,
    ).toBe('internal-address');
    expect(
      scanBoundary({ text: `https://not-${host}`, policy: 'distributable', internalHosts: [host] }),
    ).toEqual([]);
  });
});
