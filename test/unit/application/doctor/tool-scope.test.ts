import { describe, expect, it } from 'vitest';

import { checkTools } from '../../../../src/application/doctor/tools.js';
import { TrustGate } from '../../../../src/application/safety/trust.js';
import { workspaceToolScope } from '../../../../src/application/tool/scope.js';
import type { ProviderDescriptor } from '../../../../src/ports/provider.js';
import { FakeClock } from '../../../fakes/fake-clock.js';
import { FakePrompter } from '../../../fakes/fake-prompter.js';
import { FakeTrustStore } from '../../../fakes/fake-trust-store.js';
import { harness, MANIFEST_DIR } from '../../../fakes/workspace.js';

const workspace =
  'schema_version: 2\nproviders: {code-host: {provider: local-git, vars: {host: /host}}}\ndefaults: {branch: main, upstream_project: team}\nrepos: [{name: api}]\n';
const describeProvider = (id: string): ProviderDescriptor<unknown> => ({
  id,
  capability: id.endsWith('-ci') ? 'ci' : 'code-host',
  tools: id === 'local-git' ? [] : ['bitbucket-cli'],
  recipes: [],
  vars: [],
  create: () => ({}),
});
const trust = {
  gate: new TrustGate(new FakeTrustStore(), new FakePrompter(), new FakeClock()),
  yes: false,
  posture: { readOnly: false, source: 'default' as const },
};

describe('doctor tool scope', () => {
  it('does not probe unused baseline tools for a local-git workspace', async () => {
    const h = await harness({ workspace });
    const scope = workspaceToolScope(h.ctx, describeProvider, {});
    expect(scope.names).toEqual([]);
    expect(await checkTools(h.deps, { ...scope, trust })).toEqual([]);
    expect(h.process.calls).toEqual([]);
  });

  it('reports unknown configured providers while preserving known zero-tool coverage', async () => {
    const h = await harness({ workspace });
    const unknown = workspaceToolScope(h.ctx, () => undefined, {});
    expect(unknown.problems).toMatchObject([
      { group: 'manifest', id: 'provider:code-host', level: 'fail', coverage: 'incomplete' },
    ]);
    expect(workspaceToolScope(h.ctx, describeProvider, {}).problems).toEqual([]);
    const mismatched = workspaceToolScope(
      h.ctx,
      (id) => ({ ...describeProvider(id), capability: 'ci' }),
      {},
    );
    expect(mismatched.problems).toMatchObject([{ level: 'fail', coverage: 'incomplete' }]);
  });

  it('checks a tool the workspace named, whether or not it changed one of its fields', async () => {
    const h = await harness({
      workspace,
      files: {
        [`${MANIFEST_DIR}/manifest/tools.yaml`]: 'schema_version: 2\ntools: [{ name: lark-cli }]\n',
      },
    });
    const scope = workspaceToolScope(h.ctx, describeProvider, {});
    expect(scope.names).toEqual(['lark-cli']);
    expect(scope.required.has('lark-cli')).toBe(false);
  });

  it('allows explicit checks of an optional baseline tool', async () => {
    const h = await harness({ workspace });
    const scope = workspaceToolScope(h.ctx, describeProvider, { tools: ['bitbucket-cli'] });
    expect(await checkTools(h.deps, { ...scope, trust })).toMatchObject([
      { id: 'bitbucket-cli', level: 'warn', evidence: { required: false, state: 'missing' } },
    ]);
  });

  it('requires any provider descriptor dependency without knowing the provider name', async () => {
    const h = await harness({ workspace: workspace.replace('local-git', 'custom-code-host') });
    const scope = workspaceToolScope(h.ctx, describeProvider, {});
    expect(await checkTools(h.deps, { ...scope, trust })).toMatchObject([
      { id: 'bitbucket-cli', level: 'fail', evidence: { required: true, active_dependency: true } },
    ]);
  });

  it.each([true, false])('honours explicit manifest required=%s', async (required) => {
    const h = await harness({
      workspace: workspace.replace('local-git', 'custom-code-host'),
      files: {
        [`${MANIFEST_DIR}/manifest/tools.yaml`]: `schema_version: 2\ntools: [{name: bitbucket-cli, required: ${required}}]\n`,
      },
    });
    const scope = workspaceToolScope(h.ctx, describeProvider, {});
    expect(await checkTools(h.deps, { ...scope, trust })).toMatchObject([
      { id: 'bitbucket-cli', level: required ? 'fail' : 'warn', evidence: { required } },
    ]);
  });

  it.each([
    { active: false, required: true, level: 'fail', coverage: 'incomplete' },
    { active: false, required: false, level: 'ok', coverage: 'not_applicable' },
    { active: true, required: true, level: 'fail', coverage: 'incomplete' },
    { active: true, required: false, level: 'warn', coverage: 'incomplete' },
  ])(
    'uses the resolved requirement for disabled tools: %j',
    async ({ active, required, level, coverage }) => {
      const h = await harness({
        workspace: active ? workspace.replace('local-git', 'custom-code-host') : workspace,
        files: {
          [`${MANIFEST_DIR}/manifest/tools.yaml`]: `schema_version: 2\ntools: [{name: bitbucket-cli, enabled: false, required: ${required}}]\n`,
        },
      });
      const scope = workspaceToolScope(h.ctx, describeProvider, {});
      expect(await checkTools(h.deps, { ...scope, trust })).toMatchObject([
        { id: 'bitbucket-cli', level, coverage, evidence: { required, active_dependency: active } },
      ]);
    },
  );

  it('checks required and optional manifest additions without enabling all baseline tools', async () => {
    const h = await harness({
      workspace,
      files: {
        [`${MANIFEST_DIR}/manifest/tools.yaml`]:
          'schema_version: 2\ntools: [{name: required-tool, required: true}, {name: optional-tool}]\n',
      },
    });
    const scope = workspaceToolScope(h.ctx, describeProvider, {});
    expect(await checkTools(h.deps, { ...scope, trust })).toMatchObject([
      { id: 'required-tool', level: 'fail' },
      { id: 'optional-tool', level: 'warn' },
    ]);
  });

  it('keeps inactive platform tools out of readiness and marks disabled active dependencies incomplete', async () => {
    const files = {
      [`${MANIFEST_DIR}/manifest/tools.yaml`]:
        'schema_version: 2\ntools: [{name: bitbucket-cli, enabled: false}]\n',
      [`${MANIFEST_DIR}/manifest/environments.yaml`]:
        'schema_version: 2\nplatforms: {build: {provider: custom-ci, capability: ci}}\nenvs: {dev: {}, test: {platforms: {build: {}}}}\n',
    };
    const h = await harness({ workspace, local: { scope: { envs: ['dev'] } }, files });
    const inactive = workspaceToolScope(h.ctx, describeProvider, {});
    expect(await checkTools(h.deps, { ...inactive, trust })).toMatchObject([
      {
        id: 'bitbucket-cli',
        level: 'ok',
        coverage: 'not_applicable',
        evidence: { required: false },
      },
    ]);
    const other = await harness({ workspace, files });
    const active = workspaceToolScope(other.ctx, describeProvider, { envs: ['test'] });
    expect(await checkTools(other.deps, { ...active, trust })).toMatchObject([
      { id: 'bitbucket-cli', level: 'fail', coverage: 'incomplete', evidence: { required: true } },
    ]);
    const excluded = workspaceToolScope(other.ctx, describeProvider, { envs: ['dev'] });
    expect(excluded.required.has('bitbucket-cli')).toBe(false);
  });
});
