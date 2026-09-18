import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { Import } from '../../../src/application/import.js';
import { loadWorkspace } from '../../../src/domain/manifest/loader.js';
import { FakeCodeHost } from '../../fakes/fake-code-host.js';
import { FakeFs } from '../../fakes/fake-fs.js';
import { FakeGit } from '../../fakes/fake-git.js';
import { FakeReporter } from '../../fakes/fake-reporter.js';

const HOST = 'ssh://git@git.example.com:12345';
const ROOT = path.normalize(path.resolve('/ws'));
const write = {
  dryRun: false,
  posture: { readOnly: false, source: 'default' as const },
};

// A file system where /alias is a symbolic link to the root.
class AliasedFs extends FakeFs {
  override async realpath(target: string): Promise<string> {
    return path.normalize(target.replace(/^\/alias(?=\/|$)/, ROOT));
  }
}

function stage() {
  const fs = AliasedFs.from({
    [`${ROOT}/.gitmodules`]:
      '[submodule "agent-runtime"]\n\tpath = agent-runtime\n\turl = x\n\tbranch = integration\n',
    [`${ROOT}/docs/README.md`]: 'prose',
    [`${ROOT}/scratch/notes.txt`]: 'inside the root repository, not a repository itself',
  });
  fs.mkdir(`${ROOT}/plain-empty`);
  fs.mkdir(path.resolve('/alias'));
  const git = new FakeGit((dir) => fs.mkdir(dir));
  git.add(`${ROOT}/fx-example-api`, {
    remotes: {
      upstream: `${HOST}/fx/fx-example-api.git`,
      origin: `${HOST}/~alice/fx-example-api.git`,
    },
    remoteHeads: { upstream: 'dev' },
  });
  git.add(`${ROOT}/agent-runtime`, {
    remotes: { upstream: `${HOST}/ai/agent-runtime.git` },
    remoteHeads: { upstream: 'master' },
    state: { branch: 'feature/x', dirty: true, untracked: 0, ahead: 1, behind: 0 },
  });
  git.add(`${ROOT}/fx-example-scripts`, {
    remotes: { origin: `${HOST}/~alice/fx-example-scripts.git` },
    state: { branch: 'main', dirty: false, untracked: 0, ahead: 0, behind: 0 },
  });
  git.add(`${ROOT}/direct`, {
    remotes: { origin: `${HOST}/fx/direct.git` },
    remoteHeads: { origin: 'dev' },
  });
  git.add(`${ROOT}/local-only`, { remotes: {} });
  git.add(`${ROOT}/runtimes/runtime`, {
    remotes: { upstream: `${HOST}/fx/runtime.git` },
    remoteHeads: { upstream: 'dev' },
  });
  const codeHost = new FakeCodeHost(HOST);
  codeHost.readability.set('fx/fx-example-scripts', 'missing');
  codeHost.readability.set('ai/fx-example-scripts', 'readable');
  const reporter = new FakeReporter();
  const importer = new Import({
    git,
    fs,
    reporter,
    codeHost: () => codeHost,
    identifyProvider: async () => ({ provider: 'bitbucket-cli', host: HOST }),
  });
  return { fs, git, codeHost, importer };
}

describe('Import', () => {
  it('classifies the directory, infers each repository, and writes nothing unasked', async () => {
    const s = stage();
    const out = await s.importer.execute({ ...write, dir: ROOT });
    expect(out.written).toBe(false);
    expect(out.path).toBeNull();
    expect(s.fs.writes).toEqual([]);
    const doc = loadWorkspace(out.manifest, { cliVersion: '1.0.0' }).doc;
    expect(doc.defaults).toEqual({
      host: HOST,
      upstream_project: 'fx',
      branch: 'dev',
      origin_pattern: '~{user}/{repo}',
    });
    expect(doc.repos).toEqual([
      { name: 'agent-runtime', project: 'ai', branch: 'integration' },
      { name: 'direct' },
      { name: 'fx-example-api' },
      { name: 'fx-example-scripts', project: 'ai', branch: 'main' },
      { name: 'runtime', path: 'runtimes/runtime' },
    ]);
    expect(out.report).toEqual({
      repos: 5,
      skipped: [
        { path: 'docs', reason: 'not a repository' },
        { path: 'plain-empty', reason: 'not a repository' },
        { path: 'scratch', reason: 'not a repository' },
        { path: 'local-only', reason: 'no remote; a manifest describes remotes' },
      ],
      review: [
        {
          name: 'fx-example-scripts',
          note: 'upstream inferred by searching for a repository of this name; nothing in the checkout named the project.',
        },
        {
          name: 'fx-example-scripts',
          note: 'branch taken from the current checkout, which may be a task branch.',
        },
      ],
      branch_from: { gitmodules: 1, remote_head: 3, checkout: 1 },
    });
    expect(s.codeHost.probes).toEqual(['fx/fx-example-scripts', 'ai/fx-example-scripts']);
    expect(s.git.calls, 'nothing in any checkout was touched').toEqual([]);
    expect(out.manifest).toContain('# review: upstream inferred');
  });

  it('writes only where -o points, previews that under --dry-run, and respects posture', async () => {
    const s = stage();
    const out = path.resolve('/src/manifest/workspace.yaml');
    const dry = await s.importer.execute({ ...write, dir: ROOT, out, dryRun: true });
    expect(dry).toMatchObject({ path: out, written: false });
    expect(s.fs.writes).toEqual([]);
    const real = await s.importer.execute({ ...write, dir: ROOT, out });
    expect(real).toMatchObject({ path: out, written: true });
    expect(await s.fs.readText(out)).toBe(dry.manifest);
    // The person named the target; a second run replaces it.
    await s.fs.writeText(out, 'stale');
    await s.importer.execute({ ...write, dir: ROOT, out });
    expect(await s.fs.readText(out)).toBe(dry.manifest);
    await expect(
      s.importer.execute({ ...write, dir: ROOT, out, posture: { readOnly: true, source: 'env' } }),
    ).rejects.toMatchObject({ code: 'READONLY_BLOCKED' });
    for (const inside of [
      `${ROOT}/manifest/workspace.yaml`,
      `${ROOT}/fx-example-api/x.yaml`,
      `${ROOT}/..draft/out.yaml`,
      ROOT,
    ]) {
      await expect(s.importer.execute({ ...write, dir: ROOT, out: inside })).rejects.toMatchObject({
        category: 'conflict',
        code: 'IMPORT_INSIDE_ROOT',
      });
    }
    await expect(
      s.importer.execute({
        ...write,
        dir: path.resolve('/alias'),
        out: `${ROOT}/manifest/workspace.yaml`,
      }),
    ).rejects.toMatchObject({ code: 'IMPORT_INSIDE_ROOT' });
    await expect(
      s.importer.execute({
        ...write,
        dir: ROOT,
        out: path.resolve('/alias/manifest/workspace.yaml'),
      }),
    ).rejects.toMatchObject({ code: 'IMPORT_INSIDE_ROOT' });
    expect(s.fs.writes).toEqual([out, out, out]);
  });

  it('treats a failing probe as "not there" and keeps going', async () => {
    const s = stage();
    s.codeHost.canRead = async () => {
      throw new Error('offline');
    };
    const out = await s.importer.execute({ ...write, dir: ROOT, dryRun: true });
    expect(out.report.skipped.map((x) => x.path)).toContain('fx-example-scripts');
    expect(out.report.repos).toBe(4);
  });
});
