import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { setRepoField } from '../../../../src/domain/manifest/editor.js';

const original = readFileSync(path.resolve('test/fixtures/manifest/editor/workspace.yaml'), 'utf8');

describe('setRepoField', () => {
  it('adds a parsed alias array and preserves unrelated bytes', () => {
    const result = setRepoField(original, 'fx-example-auth', 'aka', '[platform, "平台"]');
    expect(result).toMatchObject({ before: null, after: '["platform","平台"]', action: 'added' });
    expect(result.text).toBe(
      original.replace(
        '    tags: [backend]\n',
        '    tags: [backend]\n    aka: ["platform","平台"]\n',
      ),
    );
  });

  it.each(['[old] # keep\n', '\n      - old\n'])(
    'replaces an alias sequence without rewriting neighboring fields: %s',
    (sequence) => {
      const text = original.replace(
        '    tags: [backend]\n',
        `    aka: ${sequence}    tags: [backend]\n`,
      );
      const result = setRepoField(text, 'fx-example-auth', 'aka', '["new", "core"]');
      expect(result.before).toBe('["old"]');
      expect(result.text).toBe(
        text.replace(
          sequence,
          sequence.startsWith('\n') ? '\n      ["new","core"]\n' : '["new","core"] # keep\n',
        ),
      );
    },
  );

  it.each(['plain', '[1]', '["ok", null]', '[" "]', '{name: x}', '[broken', '[*missing]'])(
    'refuses invalid alias arrays: %s',
    (value) => {
      expect(() => setRepoField(original, 'fx-example-auth', 'aka', value)).toThrow(
        expect.objectContaining({ category: 'usage', code: 'INVALID_MANIFEST_VALUE' }),
      );
    },
  );

  it('clears aliases with an empty array while preserving a flow entry and its comment', () => {
    const text = original.replace('desc: Static help site,', 'desc: Static help site, aka: [old],');
    const result = setRepoField(text, 'fx-example-docs', 'aka', '[]');
    expect(result.text).toBe(text.replace('aka: [old]', 'aka: []'));
    expect(result.after).toBe('[]');
  });

  it('replaces one scalar and leaves every other byte alone, quote style included', () => {
    const result = setRepoField(original, 'fx-example-api', 'branch', 'feature/x');
    expect(result).toMatchObject({ before: 'dev', after: 'feature/x', action: 'replaced' });
    expect(result.text).toBe(
      original.replace("    branch: 'dev'   # pinned", "    branch: 'feature/x'   # pinned"),
    );
  });

  it('keeps double quotes when the original had them', () => {
    const result = setRepoField(original, 'fx-example-api', 'desc', 'Backend "core"');
    expect(result.text).toBe(
      original.replace('    desc: "Backend monolith"', '    desc: "Backend \\"core\\""'),
    );
  });

  it('adds a missing field as the last line of the entry, at the sibling indentation', () => {
    const result = setRepoField(original, 'fx-example-auth', 'branch', 'main');
    expect(result).toMatchObject({ before: null, after: 'main', action: 'added' });
    expect(result.text).toBe(
      original.replace('    tags: [backend]\n', '    tags: [backend]\n    branch: main\n'),
    );
  });

  it('adds after a nested block without touching the group that follows', () => {
    const result = setRepoField(original, 'fx-example-data', 'desc', 'Data: service');
    expect(result.text).toBe(
      original.replace(
        '      svc: example-data\n',
        "      svc: example-data\n    desc: 'Data: service'\n",
      ),
    );
  });

  it('replaces inside a flow-style entry but refuses to add to one', () => {
    const replaced = setRepoField(original, 'fx-example-docs', 'desc', 'Help site');
    expect(replaced.text).toBe(original.replace('desc: Static help site,', 'desc: Help site,'));
    expect(() => setRepoField(original, 'fx-example-docs', 'branch', 'main')).toThrow(
      expect.objectContaining({ code: 'MANIFEST_SET_UNSUPPORTED' }),
    );
  });

  it('refuses list and object fields and unknown ones, with a suggestion', () => {
    expect(() => setRepoField(original, 'fx-example-api', 'tags', 'x')).toThrow(
      expect.objectContaining({ category: 'usage', code: 'MANIFEST_SET_UNSUPPORTED' }),
    );
    expect(() => setRepoField(original, 'fx-example-api', 'brnch', 'x')).toThrow(
      expect.objectContaining({
        code: 'UNKNOWN_MANIFEST_FIELD',
        hint: expect.stringContaining('branch'),
      }),
    );
  });

  it('reports an unknown repository with the nearest name', () => {
    expect(() => setRepoField(original, 'fx-example-ap', 'branch', 'x')).toThrow(
      expect.objectContaining({
        category: 'not_found',
        code: 'REPO_NOT_FOUND',
        hint: expect.stringContaining('fx-example-api'),
      }),
    );
  });

  it('reads back what it wrote', () => {
    const result = setRepoField(
      original,
      'fx-example-auth',
      'upstream',
      'ssh://git@git.example.com:12345/x/y.git',
    );
    expect(result.text).toContain('    upstream: ssh://git@git.example.com:12345/x/y.git\n');
  });
});
