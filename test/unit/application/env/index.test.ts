import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { EnvList } from '../../../../src/application/env/list.js';
import { editEnvScope } from '../../../../src/application/env/scope.js';
import { EnvShow } from '../../../../src/application/env/show.js';
import { editRepoScope } from '../../../../src/application/repo/scope.js';
import { MANIFEST_DIR, harness } from '../../../fakes/workspace.js';

const fixture = (name: string): string =>
  readFileSync(path.resolve('test/fixtures/manifest/v2-full', name), 'utf8');

const files = { [`${MANIFEST_DIR}/manifest/environments.yaml`]: fixture('environments.yaml') };
const write = { dryRun: false, posture: { readOnly: false, source: 'default' as const } };

describe('EnvList / EnvShow', () => {
  it('lists environments with their platforms and marks all picked when nothing was chosen', async () => {
    const h = await harness({ workspace: fixture('workspace.yaml'), files });
    const rows = new EnvList(h.deps).execute();
    expect(rows.map((r) => [r.name, r.picked, r.platforms])).toEqual([
      ['test', true, ['sentry', 'openobserve', 'jenkins', 'kube']],
      ['selfhosted', true, ['sentry']],
    ]);
    expect(h.reporter.notices.map((n) => n.code)).toContain('SCOPE_ENVS_UNSET');
  });

  it('shows one environment as a platform matrix, provider and merged variables included', async () => {
    const h = await harness({
      workspace: fixture('workspace.yaml'),
      files,
      local: { scope: { envs: ['test'] } },
    });
    const detail = new EnvShow(h.deps).execute('selfhosted');
    expect(detail.picked).toBe(false);
    expect(detail.platforms).toEqual([
      {
        platform: 'sentry',
        provider: 'sentry',
        capability: 'error-tracker',
        vars: { host: 'sentry.example.com', org: 'fx', team: 'fx-oem', slug: 'oem-{svc}' },
        confidence: 'unverified',
        note: 'customer-operated',
        setup: null,
      },
    ]);
    const kube = new EnvShow(h.deps).execute('test').platforms.find((p) => p.platform === 'kube');
    expect(kube?.setup).toEqual({
      source: 'https://rancher.example.com/dashboard/c/c-test/explorer',
    });
    expect(kube?.note, "the platform's note when the environment has none").toBe('read-only');
    let typo: unknown;
    try {
      new EnvShow(h.deps).execute('tset');
    } catch (err) {
      typo = err;
    }
    expect(typo).toMatchObject({ code: 'ENV_NOT_FOUND', hint: 'Did you mean "test"?' });
  });
});

describe('env pick / unpick', () => {
  it('spells the list out on the first unpick, and refuses an unknown name', async () => {
    const h = await harness({ workspace: fixture('workspace.yaml'), files });
    const out = await editEnvScope(h.deps, { names: ['selfhosted'], ...write }, 'unpick');
    expect(out).toMatchObject({ before: null, after: ['test'], changed: true, written: true });
    expect((await h.localStore.read('fx')).scope?.envs).toEqual(['test']);

    const back = await editEnvScope(h.deps, { names: ['selfhosted'], ...write }, 'pick');
    expect(back.after).toEqual(['test', 'selfhosted']);
    await expect(editEnvScope(h.deps, { names: ['prod'], ...write }, 'pick')).rejects.toMatchObject(
      {
        code: 'ENV_NOT_FOUND',
      },
    );
  });

  it('is a no-op when picking under "all", and leaves the repos scope alone', async () => {
    const h = await harness({
      workspace: fixture('workspace.yaml'),
      files,
      local: { scope: { repos: ['fx-example-api'] } },
    });
    const out = await editEnvScope(h.deps, { names: ['test'], ...write }, 'pick');
    expect(out).toMatchObject({ changed: false, written: false });
    await editEnvScope(h.deps, { names: ['test'], ...write }, 'unpick');
    expect((await h.localStore.read('fx')).scope).toEqual({
      repos: ['fx-example-api'],
      envs: ['selfhosted'],
    });
  });
});

describe('environment selection modes', () => {
  it('restores a missing scope key without altering repository selection', async () => {
    const h = await harness({
      workspace: fixture('workspace.yaml'),
      files,
      local: { scope: { repos: ['fx-example-api'], envs: ['test'] } },
    });
    expect(await editEnvScope(h.deps, { names: [], ...write }, 'all')).toMatchObject({
      before_mode: 'explicit',
      mode: 'all',
      after: null,
      written: true,
    });
    expect((await h.localStore.read('fx')).scope).toEqual({ repos: ['fx-example-api'] });
    expect(await editEnvScope(h.deps, { names: [], ...write }, 'none')).toMatchObject({
      mode: 'none',
      after: [],
    });
    expect(
      await editEnvScope(h.deps, { names: ['test', 'test'], ...write }, 'replace'),
    ).toMatchObject({ mode: 'explicit', after: ['test'] });
  });

  it('preserves simultaneous repository and environment edits against the latest local layer', async () => {
    const h = await harness({
      workspace: fixture('workspace.yaml'),
      files,
      local: { scope: { repos: ['fx-example-api'], envs: ['test'] } },
    });
    await Promise.all([
      editRepoScope(h.deps, { names: [], ...write }, 'all'),
      editEnvScope(h.deps, { names: ['selfhosted'], ...write }, 'replace'),
    ]);
    expect((await h.localStore.read('fx')).scope).toEqual({ envs: ['selfhosted'] });
  });

  it('rejects contradictory or unknown input and respects readonly posture', async () => {
    const h = await harness({ workspace: fixture('workspace.yaml'), files });
    for (const operation of ['all', 'none'] as const)
      await expect(
        editEnvScope(h.deps, { names: ['test'], ...write }, operation),
      ).rejects.toMatchObject({ code: 'INPUT_INVALID' });
    await expect(
      editEnvScope(h.deps, { names: ['missing'], ...write }, 'replace'),
    ).rejects.toMatchObject({ code: 'ENV_NOT_FOUND' });
    await expect(
      editEnvScope(
        h.deps,
        { names: ['test'], dryRun: false, posture: { readOnly: true, source: 'env' } },
        'replace',
      ),
    ).rejects.toMatchObject({ code: 'READONLY_BLOCKED' });
    expect((await h.localStore.read('fx')).scope).toBeUndefined();
  });
});
