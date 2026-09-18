import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { SnapshotReader } from '../../../../src/adapters/fs/snapshot-reader.js';
import { ValidateContribution } from '../../../../src/application/contribution/validate.js';
import { providerCatalog } from '../../../../src/composition/registry.js';
import { buildContributionCandidate } from '../../../../src/domain/contribution/candidate.js';

const workspace =
  'schema_version: 2\nproviders:\n  code-host: { provider: local-git, vars: { host: https://git.example.com } }\ndefaults: { branch: main }\nrepos: [{ name: example, desc: Example repository }]\n';
const base = {
  'manifest/workspace.yaml': workspace,
  'notes.md': 'original',
  'private-notes.md': 'sensitive: true\npeople: []',
};
const validator = new ValidateContribution(
  {
    open: (files) => ({
      root: path.resolve('/candidate'),
      reader: new SnapshotReader({ root: path.resolve('/candidate'), files }),
    }),
  },
  () => readFileSync('defaults/tools.yaml', 'utf8'),
  providerCatalog(),
);
const file = (path: string, content: string) => ({
  path,
  content,
  mode: '100644' as const,
  kind: 'file' as const,
});

describe('candidate contribution validation', () => {
  it('validates the captured base plus selected bytes, excluding unrelated dirty content', async () => {
    const changes = [file('notes.md', 'new notes')];
    const candidate = buildContributionCandidate({ base, changes });
    expect(candidate['manifest/workspace.yaml']).toBe(workspace);
    expect(candidate['notes.md']).toBe('new notes');
    expect(base['notes.md']).toBe('original');
    expect(
      await validator.execute({ files: candidate, changes, cliVersion: '1.0.0' }),
    ).toMatchObject({ ok: true, findings: [] });
  });
  it('rejects a candidate that differs from the bytes presented for scanning', async () => {
    const changes = [file('notes.md', 'reviewed')];
    const result = await validator.execute({
      files: { ...base, 'notes.md': 'different' },
      changes,
      cliVersion: '1.0.0',
    });
    expect(result.ok).toBe(false);
    expect(result.findings[0]?.rule).toBe('snapshot-mismatch');
  });
  it('refuses invalid selected manifest bytes', async () => {
    const changes = [file('manifest/workspace.yaml', 'schema_version: 2\nrepos: broken')];
    const result = await validator.execute({
      files: buildContributionCandidate({ base, changes }),
      changes,
      cliVersion: '1.0.0',
    });
    expect(result.ok).toBe(false);
    expect(result.findings.some((f) => f.rule === 'manifest-invalid')).toBe(true);
  });
  it('validates harness in the captured contribution candidate', async () => {
    const changes = [
      file(
        'manifest/harness.yaml',
        JSON.stringify({
          schema_version: 2,
          mcp: [{ name: 'remote', transport: 'http', command: ['server'] }],
        }),
      ),
    ];
    const result = await validator.execute({
      files: buildContributionCandidate({ base, changes }),
      changes,
      cliVersion: '1.0.0',
    });
    expect(result).toMatchObject({
      ok: false,
      findings: [{ path: 'manifest/harness.yaml', rule: 'manifest-invalid' }],
    });
  });
  it('does not accept a candidate that deletes the mandatory document', async () => {
    const changes = [
      {
        path: 'manifest/workspace.yaml',
        content: null,
        kind: 'deleted' as const,
        mode: '100644' as const,
      },
    ];
    const result = await validator.execute({
      files: buildContributionCandidate({ base, changes }),
      changes,
      cliVersion: '1.0.0',
    });
    expect(result.ok).toBe(false);
    expect(result.findings[0]?.rule).toBe('manifest-missing');
  });
  it('blocks lint findings from team skills, even with a valid schema', async () => {
    const changes = [file('skills/broken/SKILL.md', 'missing frontmatter')];
    const result = await validator.execute({
      files: buildContributionCandidate({ base, changes }),
      changes,
      cliVersion: '1.0.0',
    });
    expect(result.ok).toBe(false);
    expect(result.findings.some((f) => f.rule === 'manifest-lint')).toBe(true);
  });
  it('rejects protected content in an expanded filename without returning that name', async () => {
    const name = ['person', ['team', 'invalid'].join('.')].join('@') + '.md';
    const changes = [file(name, 'ordinary text')];
    const result = await validator.execute({
      files: buildContributionCandidate({ base, changes }),
      changes,
      cliVersion: '1.0.0',
    });
    expect(result.ok).toBe(false);
    expect(JSON.stringify(result)).not.toContain(name);
  });
  it('rejects secrets before returning any schema diagnostics that could echo them', async () => {
    const secret = ['ghp_', 'x'.repeat(36)].join('');
    const changes = [file('manifest/workspace.yaml', `schema_version: ${secret}`)];
    const result = await validator.execute({
      files: buildContributionCandidate({ base, changes }),
      changes,
      cliVersion: '1.0.0',
    });
    expect(result.ok).toBe(false);
    expect(result.findings.some((f) => f.rule === 'credential')).toBe(true);
    expect(JSON.stringify(result)).not.toContain(secret);
  });
  it('allows manifest addresses while retaining unrelated existing personnel files', async () => {
    const changes = [file('notes.md', `endpoint: https://${['service', 'internal'].join('.')}`)];
    const candidate = buildContributionCandidate({ base, changes });
    expect((await validator.execute({ files: candidate, changes, cliVersion: '1.0.0' })).ok).toBe(
      true,
    );
  });
});
