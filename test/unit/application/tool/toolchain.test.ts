// fx assumes no tool: what a workspace has follows from what it binds and what it declares.

import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { resolveToolchain, toolchainOf } from '../../../../src/application/tool/toolchain.js';
import { DevkitError } from '../../../../src/domain/errors.js';
import { commandOrigin } from '../../../../src/domain/toolchain/resolve.js';
import { FakeReporter } from '../../../fakes/fake-reporter.js';
import { harness, MANIFEST_DIR } from '../../../fakes/workspace.js';

const workspace = (providers: string): string =>
  `schema_version: 2\nproviders: {${providers}}\ndefaults: {branch: main, upstream_project: team}\nrepos: [{name: api}]\n`;

const environments =
  'schema_version: 2\nplatforms: {build: {provider: jenkins-cli, capability: ci, vars: {path: jobs}}}\nenvs: {dev: {}, test: {platforms: {build: {}}}}\n';

const local = 'code-host: {provider: local-git, vars: {host: /host}}';

describe('toolchainOf', () => {
  it('derives the tool a bound provider drives without the workspace naming it', async () => {
    const h = await harness({
      workspace: workspace('code-host: {provider: bitbucket-cli, vars: {host: /host}}'),
    });
    const toolchain = toolchainOf(h.ctx);
    expect(toolchain.tools.map((tool) => tool.name)).toEqual(['bitbucket-cli']);
    expect(toolchain.sources.get('bitbucket-cli')).toEqual({
      kind: 'binding',
      boundBy: ['code-host'],
    });
  });

  it('keeps a declared tool no binding needs, and says the declaration is why', async () => {
    const h = await harness({
      workspace: workspace(local),
      files: {
        [`${MANIFEST_DIR}/manifest/tools.yaml`]: 'schema_version: 3\ntools: [{ name: lark-cli }]\n',
      },
    });
    const toolchain = toolchainOf(h.ctx);
    expect(toolchain.tools.map((tool) => tool.name)).toEqual(['lark-cli']);
    expect(toolchain.sources.get('lark-cli')?.kind).toBe('manifest');
  });

  it('leaves everything else in the catalog, known but unselected', async () => {
    const h = await harness({ workspace: workspace(local) });
    const toolchain = toolchainOf(h.ctx);
    expect(toolchain.tools).toEqual([]);
    expect(toolchain.catalog.map((tool) => tool.name)).toContain('jenkins-cli');
    expect(toolchain.sources.get('jenkins-cli')?.kind).toBe('catalog');
    expect(toolchain.all.length).toBe(toolchain.catalog.length);
  });

  it('reads a bound tool as bound even where the workspace also declares it', async () => {
    const h = await harness({
      workspace: workspace('code-host: {provider: bitbucket-cli, vars: {host: /host}}'),
      files: {
        [`${MANIFEST_DIR}/manifest/tools.yaml`]:
          'schema_version: 3\ntools: [{ name: bitbucket-cli }]\n',
      },
    });
    // Removing the declaration would change nothing, so the binding is the honest answer.
    expect(toolchainOf(h.ctx).sources.get('bitbucket-cli')?.kind).toBe('binding');
  });

  it('vouches for a derived tool: fx owns every field, so nobody confirms its commands', async () => {
    const h = await harness({
      workspace: workspace('code-host: {provider: bitbucket-cli, vars: {host: /host}}'),
    });
    const [tool] = toolchainOf(h.ctx).tools;
    expect(tool?.patchedFields).toEqual([]);
    expect(commandOrigin(tool!)).toBe('base');
  });

  it('spans every environment, because installing a tool is not per environment', async () => {
    const h = await harness({
      workspace: workspace(local),
      local: { scope: { envs: ['dev'] } },
      files: { [`${MANIFEST_DIR}/manifest/environments.yaml`]: environments },
    });
    // `build` belongs to test only, and the machine is scoped to dev.
    expect(toolchainOf(h.ctx).sources.get('jenkins-cli')).toEqual({
      kind: 'binding',
      boundBy: ['ci:build'],
    });
  });

  it('binds a capability fx names to a provider only the team has', async () => {
    const h = await harness({
      workspace: workspace(`${local}, worklog: {provider: fx-worklog-cli}`),
      files: {
        [`${MANIFEST_DIR}/manifest/tools.yaml`]:
          'schema_version: 3\ntools: [{ name: fx-worklog-cli, install: [{ via: npm, spec: "@example/worklog-cli" }] }]\n',
      },
    });
    expect(toolchainOf(h.ctx).sources.get('fx-worklog-cli')).toEqual({
      kind: 'binding',
      boundBy: ['worklog'],
    });
  });

  it('derives a provider only the manifest defines from the tool it declares', async () => {
    const files = {
      [`${MANIFEST_DIR}/manifest/tools.yaml`]:
        'schema_version: 3\ntools: [{ name: worklog-cli, install: [{ via: npm, spec: "@example/worklog-cli" }] }]\n',
    };
    const h = await harness({
      workspace: workspace(`${local}, issue-tracker: {provider: worklog-cli}`),
      files,
    });
    expect(toolchainOf(h.ctx).sources.get('worklog-cli')).toEqual({
      kind: 'binding',
      boundBy: ['issue-tracker'],
    });
    // A catalog name is a tool, not a provider id: it must not stand in for one.
    const typo = await harness({
      workspace: workspace(`${local}, issue-tracker: {provider: meegle}`),
    });
    expect(toolchainOf(typo.ctx).sources.get('meegle')?.kind).toBe('catalog');
  });
});

describe('a tool several providers drive', () => {
  it('appears once, and names every binding that reached for it', async () => {
    const h = await harness({
      workspace: workspace(
        `${local}, im: {provider: lark}, knowledge-base: {provider: lark-wiki, vars: {space: TEAM}}`,
      ),
    });
    const toolchain = toolchainOf(h.ctx);
    expect(toolchain.tools.map((tool) => tool.name)).toEqual(['lark-cli']);
    expect(toolchain.sources.get('lark-cli')).toEqual({
      kind: 'binding',
      boundBy: ['knowledge-base', 'im'],
    });
  });
});

describe('resolveToolchain', () => {
  function outside(failure: DevkitError) {
    const reporter = new FakeReporter();
    return {
      reporter,
      source: {
        workspace: () => Promise.reject(failure),
        bundledTools: () => readFileSync(path.resolve('defaults/tools.yaml'), 'utf8'),
        cliVersion: '1.0.0',
        reporter,
      },
    };
  }

  it('stands the whole bundled catalog in outside a workspace, and says so', async () => {
    const s = outside(new DevkitError('not_found', 'WORKSPACE_NOT_FOUND', 'No workspace here'));
    const toolchain = await resolveToolchain(s.source);
    expect(toolchain.workspace).toBeUndefined();
    expect(toolchain.tools.map((tool) => tool.name)).toContain('bitbucket-cli');
    expect(toolchain.all).toEqual(toolchain.tools);
    expect(toolchain.sources.get('bitbucket-cli')).toEqual({ kind: 'catalog', boundBy: [] });
    expect(s.reporter.codes()).toEqual(['TOOLCHAIN_BUNDLED']);
  });

  it('reports a workspace it cannot read instead of answering from the bundled catalog', async () => {
    const s = outside(new DevkitError('config', 'MANIFEST_INVALID', 'The manifest is invalid'));
    await expect(resolveToolchain(s.source)).rejects.toMatchObject({ code: 'MANIFEST_INVALID' });
    expect(s.reporter.notices).toEqual([]);
  });
});
