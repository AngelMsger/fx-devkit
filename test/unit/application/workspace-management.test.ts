import { mkdtempSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { FileSource } from '../../../src/adapters/manifest-source/file.js';
import { assertDistinctWorkspaceRoot } from '../../../src/application/workspace/registry.js';
import { createContainer } from '../../../src/composition/container.js';
import { workspaceManagement } from '../../../src/composition/workspace-management.js';
import { FakeConfigStore } from '../../fakes/fake-config-store.js';
import { FakeReporter } from '../../fakes/fake-reporter.js';

const writable = { readOnly: false, source: 'default' } as const;
const manifest = readFileSync(
  path.resolve('test/fixtures/manifest/v1-minimal/workspace.yaml'),
  'utf8',
);
async function setup() {
  const home = mkdtempSync(path.join(tmpdir(), 'fx-identity-'));
  const base = createContainer({ FX_HOME: home });
  const root = path.join(home, 'root');
  await base.fs.writeText(path.join(root, 'business.txt'), 'keep');
  const before = { root, source: '/source/old' };
  const config = new FakeConfigStore({ workspaces: { alpha: before }, agents: [], hooks: false });
  const container = { ...base, config };
  const source = container.manifestDirFor('alpha');
  await container.fs.writeText(path.join(source, 'manifest/workspace.yaml'), manifest);
  await container.fs.writeText(path.join(source, 'uncommitted.txt'), 'source edits');
  const next = path.join(home, 'next');
  await container.fs.writeText(path.join(next, 'manifest/workspace.yaml'), manifest);
  const reporter = new FakeReporter();
  const usecase = workspaceManagement({
    container,
    resolve: {
      cwd: root,
      fs: container.fs,
      config,
      reporter,
      manifestDirFor: container.manifestDirFor,
    },
    env: { FX_AGENTS: '', FX_HOOKS: '0' },
    cliVersion: '1.0.0',
    noInput: true,
    yes: false,
    posture: writable,
  });
  return {
    container,
    config,
    before,
    source,
    root,
    usecase,
    input: {
      name: 'alpha',
      action: 'rebind' as const,
      source: new FileSource(next, container.fs),
      dryRun: false,
      posture: writable,
    },
  };
}

describe('workspace identity recovery', () => {
  it('retains an interrupted rebind and resumes registration without replacing its original backup', async () => {
    const s = await setup();
    const update = s.config.update.bind(s.config);
    let fail = true;
    s.config.update = async (change) => {
      if (fail) {
        fail = false;
        throw new Error('registration interrupted');
      }
      return update(change);
    };
    await expect(s.usecase.execute(s.input)).rejects.toMatchObject({
      message: 'registration interrupted',
      partialResult: { recovery: expect.any(String) },
    });
    expect((await s.config.read()).workspaces?.alpha).toEqual(s.before);
    const journalFile = path.join(path.dirname(s.source), 'workspace-operation.json');
    const journal = JSON.parse(readFileSync(journalFile, 'utf8'));
    expect(journal.phase).toBe('source_replaced');
    const result = await s.usecase.execute(s.input);
    expect(result.written).toBe(true);
    expect(readFileSync(path.join(result.backup!, 'uncommitted.txt'), 'utf8')).toBe('source edits');
    expect(readFileSync(path.join(s.root, 'business.txt'), 'utf8')).toBe('keep');
    expect(existsSync(journalFile)).toBe(false);
    expect((await s.config.read()).workspaces?.alpha?.source).toBe(s.input.source.description);
  });

  it('validates local rebind previews and refuses distinct identities at the same physical root', async () => {
    const s = await setup();
    const writes = s.config.writes;
    await expect(
      s.usecase.execute({
        ...s.input,
        source: new FileSource('/missing/fx-fixture', s.container.fs),
        dryRun: true,
      }),
    ).rejects.toMatchObject({ code: 'MANIFEST_SOURCE_INVALID' });
    expect(s.config.writes).toBe(writes);
    await expect(
      assertDistinctWorkspaceRoot(await s.config.read(), 'beta', s.root, s.container.fs),
    ).rejects.toMatchObject({ code: 'WORKSPACE_ROOT_TAKEN' });
  });
  it('retries incomplete backup copies before replacing the source', async () => {
    const s = await setup();
    const copy = s.container.fs.copyDir.bind(s.container.fs);
    let interrupted = false;
    s.container.fs.copyDir = async (from, to) => {
      if (!interrupted && to.endsWith('.pending')) {
        interrupted = true;
        await s.container.fs.writeText(path.join(to, 'partial.txt'), 'incomplete');
        throw new Error('copy interrupted');
      }
      await copy(from, to);
    };
    await expect(s.usecase.execute(s.input)).rejects.toMatchObject({ message: 'copy interrupted' });
    expect(readFileSync(path.join(s.source, 'uncommitted.txt'), 'utf8')).toBe('source edits');
    const result = await s.usecase.execute(s.input);
    expect(readFileSync(path.join(result.backup!, 'uncommitted.txt'), 'utf8')).toBe('source edits');
    expect(existsSync(path.join(result.backup!, 'partial.txt'))).toBe(false);
  });
});
