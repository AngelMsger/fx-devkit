import { describe, expect, it } from 'vitest';

import { negotiate, negotiationError } from '../../../../src/domain/manifest/versioning.js';

describe('negotiate', () => {
  it('accepts a supported schema with no floor', () => {
    expect(negotiate({ schema_version: 1 }, '1.2.3', [1, 2])).toEqual({
      schema: 1,
      minCli: undefined,
      failure: undefined,
    });
  });

  it('rejects a schema older than the oldest supported one', () => {
    expect(negotiate({ schema_version: 1 }, '1.0.0', [2]).failure).toBe('schema_too_old');
  });

  it('rejects a schema newer than the newest supported one', () => {
    expect(negotiate({ schema_version: 3 }, '1.0.0', [1, 2]).failure).toBe('schema_too_new');
  });

  it('rejects a released CLI below the document floor', () => {
    expect(negotiate({ schema_version: 2, min_cli: '1.5.0' }, '1.4.9', [2]).failure).toBe(
      'cli_too_old',
    );
    expect(
      negotiate({ schema_version: 2, min_cli: '1.5.0' }, '1.5.0', [2]).failure,
    ).toBeUndefined();
  });

  it('skips the floor for a development build', () => {
    expect(
      negotiate({ schema_version: 2, min_cli: '9.0.0' }, '0.0.0', [2]).failure,
    ).toBeUndefined();
    expect(
      negotiate({ schema_version: 2, min_cli: '9.0.0' }, '1.0.0-dev.3', [2]).failure,
    ).toBeUndefined();
  });

  it('leaves a missing or malformed schema_version to validation', () => {
    expect(negotiate({}, '1.0.0', [1]).schema).toBeUndefined();
    expect(negotiate({ schema_version: 'two' }, '1.0.0', [1]).schema).toBeUndefined();
  });

  it('leaves a malformed min_cli to manifest validation instead of version negotiation', () => {
    expect(negotiate({ schema_version: 1, min_cli: 'bananas' }, '1.0.0', [1])).toEqual({
      schema: 1,
      minCli: 'bananas',
      failure: undefined,
    });
  });
});

describe('negotiationError', () => {
  it('is fatal for every failure, names the upgrade, and names no host', () => {
    for (const failure of ['schema_too_old', 'schema_too_new', 'cli_too_old'] as const) {
      const err = negotiationError('workspace', { schema: 5, minCli: '9.0.0', failure }, '1.0.0');
      expect(err).toMatchObject({ category: 'config', code: `MANIFEST_${failure.toUpperCase()}` });
      expect(err?.nextSteps.join('\n')).toContain('fx self update --dry-run');
      expect(err?.nextSteps.join('\n')).not.toMatch(/https?:\/\//);
    }
    expect(
      negotiationError('workspace', { schema: 1, minCli: undefined, failure: undefined }, '1.0.0'),
    ).toBeUndefined();
  });
});
