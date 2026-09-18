import { describe, expect, it } from 'vitest';

import { sourceValidationError } from '../../../src/application/manifest/source-error.js';
import { workspaceItemNotFound } from '../../../src/application/workspace/guidance.js';
import { providerCatalog } from '../../../src/composition/registry.js';
import { DevkitError } from '../../../src/domain/errors.js';

describe('scoped recovery formatting', () => {
  it('keeps the resolved workspace in PowerShell recovery commands', () => {
    const failure = workspaceItemNotFound(
      { ctx: { name: 'alpha' }, commandShell: 'powershell' },
      { kind: 'env', name: 'tset', known: ['test'] },
    );
    expect(failure.code).toBe('ENV_NOT_FOUND');
    expect(failure.hint).toBe('Did you mean "test"?');
    expect(failure.nextSteps).toEqual(["& 'fx' 'env' 'list' '--workspace' 'alpha'"]);
  });

  it('quotes candidate paths without substituting the registered workspace source', () => {
    const failure = sourceValidationError(
      new DevkitError('config', 'MANIFEST_INVALID', 'repos must be a list'),
      {
        source: { kind: 'repo', description: "C:\\candidate's source" },
        inspected: { root: "C:\\candidate's source@HEAD", contents: 'commit' },
        preservedWorkspace: 'alpha',
        commandShell: 'powershell',
        retry: [
          'fx',
          'workspace',
          'rebind',
          'alpha',
          '--from',
          "C:\\candidate's source",
          '--dry-run',
        ],
      },
    );
    expect(failure.code).toBe('MANIFEST_INVALID');
    expect(failure.message).toContain("C:\\candidate's source@HEAD");
    expect(failure.nextSteps).toEqual([
      "& 'fx' 'workspace' 'rebind' 'alpha' '--from' 'C:\\candidate''s source' '--dry-run'",
    ]);
    expect(failure.hint).toContain('Correct and commit');
    expect(failure.hint).toContain('Workspace "alpha" still uses its registered source.');
    expect(failure.partialResult).toBeUndefined();
  });
});

it('identifies materialized candidates without redirecting validation to the registered source', async () => {
  const { materializeRebindSource } =
    await import('../../../src/application/workspace/source-preview.js');
  const { FakeFs } = await import('../../fakes/fake-fs.js');
  const fs = new FakeFs();
  const source = {
    kind: 'repo' as const,
    description: 'https://git.example.com/team/candidate.git',
    materialize: async (dir: string) =>
      fs.writeText(`${dir}/manifest/workspace.yaml`, 'schema_version: 2\nrepos: invalid\n'),
  };
  await expect(
    materializeRebindSource(
      source,
      {
        fs,
        bundledTools: () => '',
        providers: providerCatalog(),
        cliVersion: '1.0.0',
        workspace: 'alpha',
      },
      '/personal/source.rebind-fixture',
    ),
  ).rejects.toMatchObject({
    code: 'MANIFEST_INVALID',
    message: expect.stringContaining('Inspected source: /personal/source.rebind-fixture'),
    nextSteps: [
      'fx workspace rebind alpha --from https://git.example.com/team/candidate.git --dry-run',
    ],
    hint: expect.stringContaining('Workspace "alpha" still uses its registered source.'),
  });
});
