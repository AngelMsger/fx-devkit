// Identical payloads must produce the same guides and assets across transports.
// All repositories, homes and conflicting user files stay inside temp dirs.
import { cpSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { freshHome, fx, git, manifestDirOf, repository } from './harness.js';

const content = {
  'AGENTS.md':
    '# Shared guide\nRead docs/guide.md\n<!-- fx:begin environments -->\n<!-- fx:end environments -->\n',
  'docs/guide.md': '# Shared background\n',
  'skills/review/SKILL.md':
    '---\nname: review\ndescription: Team review\n---\nRead references/check.md\n',
  'skills/review/references/check.md': 'Check the actual callers.\n',
};

function payload(base: string): Record<string, string> {
  const host = path.join(base, 'host');
  mkdirSync(path.join(host, 'fx'), { recursive: true });
  repository(path.join(host, 'fx'), 'sample', { 'README.md': 'Sample repository' });
  return {
    ...content,
    'manifest/workspace.yaml': [
      'schema_version: 2',
      `providers: { code-host: { provider: local-git, vars: { host: ${host}, user: alice } } }`,
      'defaults: { upstream_project: fx, branch: main }',
      'repos: [{ name: sample }]',
      '',
    ].join('\n'),
  };
}

describe('source parity', () => {
  it('materializes Git, directory, manifest subdirectory and stdin bundles with the same docs and binary assets', () => {
    const base = mkdtempSync(path.join(tmpdir(), 'fx-parity-'));
    const files = payload(base);
    const repo = repository(base, 'source', files);
    const directory = path.join(base, 'directory');
    mkdirSync(directory);
    for (const name of Object.keys(files)) {
      mkdirSync(path.dirname(path.join(directory, name)), { recursive: true });
      cpSync(path.join(repo.author, name), path.join(directory, name));
    }
    const binary = Buffer.from([0, 255, 128, 10]);
    const asset = 'skills/review/asset.bin';
    writeFileSync(path.join(directory, asset), binary);
    writeFileSync(path.join(repo.author, asset), binary);
    // Commit the binary without a text round-trip.
    git(['add', '.'], repo.author);
    git(['commit', '-qm', 'asset'], repo.author);
    git(['push', '-q'], repo.author);
    const bundle = JSON.stringify({
      source_version: 1,
      files: { ...files, [asset]: { base64: binary.toString('base64') } },
    });
    const guides: string[] = [];
    for (const [index, source] of [
      repo.bare,
      directory,
      path.join(directory, 'manifest'),
      '-',
    ].entries()) {
      const home = freshHome();
      const root = path.join(base, `ws-${index}`);
      const result = fx(
        ['init', root, '--from', source, '--format', 'json'],
        { FX_HOME: home },
        undefined,
        source === '-' ? bundle : undefined,
      );
      expect(result.status, result.stderr).toBe(0);
      expect(readFileSync(path.join(root, 'sample', 'README.md'), 'utf8')).toBe(
        'Sample repository',
      );
      const materialized = manifestDirOf(home, `ws-${index}`);
      for (const [name, text] of Object.entries(files))
        expect(readFileSync(path.join(materialized, name), 'utf8')).toBe(text);
      expect(readFileSync(path.join(materialized, asset))).toEqual(binary);
      guides.push(
        readFileSync(path.join(root, 'AGENTS.md'), 'utf8').split('\n').slice(1).join('\n'),
      );
    }
    expect(new Set(guides).size).toBe(1);
  });

  it('requires approval for user documents and preserves the original in a backup', () => {
    const base = mkdtempSync(path.join(tmpdir(), 'fx-conflict-'));
    const source = repository(base, 'source', payload(base));
    const home = freshHome();
    const root = path.join(base, 'ws');
    mkdirSync(root);
    writeFileSync(path.join(root, 'AGENTS.md'), 'My original rules');
    const args = ['init', root, '--from', source.bare, '--format', 'json'];
    const refused = fx([...args, '--no-input'], { FX_HOME: home });
    expect(refused.error().code).toBe('INPUT_REQUIRED');
    expect(readFileSync(path.join(root, 'AGENTS.md'), 'utf8')).toBe('My original rules');
    const accepted = fx([...args, '--yes'], { FX_HOME: home });
    expect(accepted.status, accepted.stderr).toBe(0);
    expect(readFileSync(path.join(root, 'AGENTS.md.fx-backup'), 'utf8')).toBe('My original rules');
    expect(readFileSync(path.join(root, 'AGENTS.md'), 'utf8')).toContain('# Shared guide');
  });
});
