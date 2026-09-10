import { writeFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { fx } from './harness.js';
import { sourceFixture, sourceFingerprint, sourceMetadata } from './source-harness.js';

describe('source push command', () => {
  it('previews multiple paths with flags and writes no FX_HOME state, even with update checks enabled', () => {
    const f = sourceFixture();
    const before = sourceFingerprint(f.home);
    const result = fx(
      ['source', 'push', 'notes.md', ...sourceMetadata, '--dry-run', '--', 'note one.md'],
      { ...f.env, FX_UPDATE_CHECK: '1', FX_READ_ONLY: '1' },
      f.workspace,
    );
    expect(result.status, result.stderr).toBe(0);
    expect(result.json()).toMatchObject({
      action: 'create',
      files: ['note one.md', 'notes.md'],
      validated: true,
      written: false,
    });
    expect(sourceFingerprint(f.home)).toBe(before);
  });
  it('uses configured ownership while still rejecting a different personal fork', () => {
    const f = sourceFixture();
    const args = ['source', 'push', 'notes.md', ...sourceMetadata, '--dry-run'];
    const env = { ...f.env, FX_TEST_UNKNOWN_ACTOR: '1', FX_USER: 'alice' };
    const before = sourceFingerprint(f.home);
    const result = fx(args, env, f.workspace);
    expect(result.status, result.stderr).toBe(0);
    expect(result.json()).toMatchObject({
      source: { project: '~alice', name: 'manifest' },
      validated: true,
    });
    const wrong = fx(args, { ...env, FX_USER: 'bob' }, f.workspace);
    expect(wrong.error().code).toBe('SOURCE_REMOTE_UNSAFE');
    expect(sourceFingerprint(f.home)).toBe(before);
  });
  it('requires explicit missing inputs without hanging and rejects unknown flags', () => {
    const f = sourceFixture();
    expect(
      fx(['source', 'push', '--no-input', '--format', 'json'], f.env, f.workspace).error().code,
    ).toBe('INPUT_REQUIRED');
    expect(
      fx(['source', 'push', 'notes.md', ...sourceMetadata, '--bogus'], f.env, f.workspace).error()
        .code,
    ).toBe('BAD_FLAG');
  });
  it('enforces read-only posture and non-interactive confirmation without creating a journal', () => {
    const f = sourceFixture();
    const before = sourceFingerprint(f.home);
    const locked = fx(
      ['source', 'push', 'notes.md', ...sourceMetadata, '--yes'],
      { ...f.env, FX_READ_ONLY: '1' },
      f.workspace,
    );
    expect(locked.error().code).toBe('READONLY_BLOCKED');
    const unconfirmed = fx(
      ['source', 'push', 'notes.md', ...sourceMetadata, '--no-input'],
      f.env,
      f.workspace,
    );
    expect(unconfirmed.error().code).toBe('CONFIRM_REQUIRED');
    expect(sourceFingerprint(f.home)).toBe(before);
  });
  it('rejects a non-repository source without changing its files', () => {
    const f = sourceFixture();
    writeFileSync(
      path.join(f.home, 'config.yaml'),
      JSON.stringify({
        default_workspace: 'test',
        workspaces: { test: { root: f.workspace, source: '-' } },
      }),
    );
    const before = sourceFingerprint(f.home);
    const result = fx(
      ['source', 'push', 'notes.md', ...sourceMetadata, '--dry-run'],
      f.env,
      f.workspace,
    );
    expect(result.error().code).toBe('SOURCE_NOT_GIT');
    expect(sourceFingerprint(f.home)).toBe(before);
  });
  it('does not load unrelated broken working manifest bytes and suggests the source subcommand', () => {
    const f = sourceFixture();
    writeFileSync(path.join(f.source, 'manifest/workspace.yaml'), 'broken: [');
    const result = fx(
      ['source', 'push', 'notes.md', ...sourceMetadata, '--dry-run'],
      f.env,
      f.workspace,
    );
    expect(result.status, result.stderr).toBe(0);
    expect(result.json()).toMatchObject({ validated: true });
    const typo = fx(['source', 'psuh', '--format', 'json'], f.env, f.workspace);
    expect(typo.error().code).toBe('UNKNOWN_COMMAND');
    expect(typo.error().hint).toContain('source push');
  });
});
