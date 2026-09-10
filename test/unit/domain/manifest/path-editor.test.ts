import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

import { setYamlStrings } from '../../../../src/domain/manifest/path-editor.js';

const at = ['envs', 'dev', 'platforms', 'ci'];

describe('scoped YAML string edits', () => {
  it('preserves unrelated flow entries and comments while adding a scoped observation', () => {
    const text =
      '# header\nenvs:\n  dev:\n    platforms:\n      ci: { vars: { path: "jobs/{repo}" }, confidence: unverified } # keep\n  other: { label: "untouched" }\n';
    const result = setYamlStrings({
      text,
      values: [
        { path: [...at, 'observations', 'app', 'confidence'], value: 'verified' },
        { path: [...at, 'observations', 'app', 'note'], value: '2026-09-09: probe {path}' },
      ],
    });
    expect(result).toContain('vars: { path: "jobs/{repo}" }, confidence: unverified');
    expect(result.endsWith(' # keep\n  other: { label: "untouched" }\n')).toBe(true);
    expect(parse(result).envs.dev.platforms.ci.observations.app).toEqual({
      confidence: 'verified',
      note: '2026-09-09: probe {path}',
    });
  });
  it('keeps non-target block bytes and the prior multiline note content', () => {
    const text =
      'envs:\n  dev:\n    platforms:\n      ci:\n        vars: { path: shared } # coordinate\n        note: | # explanation\n          original note\n        confidence: unverified\n  other: {}\n';
    const result = setYamlStrings({
      text,
      values: [
        { path: [...at, 'note'], value: 'original note\n2026-09-09 probe\n' },
        { path: [...at, 'confidence'], value: 'verified' },
      ],
    });
    expect(result).toContain('vars: { path: shared } # coordinate\n');
    expect(result).toContain('| # explanation');
    expect(result.endsWith('  other: {}\n')).toBe(true);
    expect(parse(result).envs.dev.platforms.ci.note).toBe('original note\n2026-09-09 probe\n');
  });
  it('refuses edits through aliases or anchored mappings that would affect another scope', () => {
    const text =
      'shared: &shared { confidence: unverified }\nenvs: { dev: { platforms: { ci: *shared } } }\n';
    expect(() =>
      setYamlStrings({ text, values: [{ path: [...at, 'confidence'], value: 'verified' }] }),
    ).toThrow(expect.objectContaining({ code: 'MANIFEST_EDIT_UNSUPPORTED' }));
  });
  it('supports empty flow mappings, trailing commas and CRLF without rewriting siblings', () => {
    const text = 'envs: {dev: {platforms: {ci: {},},},}\r\nother: keep\r\n';
    const result = setYamlStrings({ text, values: [{ path: [...at, 'note'], value: 'a note' }] });
    expect(parse(result).envs.dev.platforms.ci.note).toBe('a note');
    expect(result.endsWith('\r\nother: keep\r\n')).toBe(true);
  });
});
