import { describe, expect, it } from 'vitest';

import { checkTools } from '../../../../src/application/doctor/tools.js';
import type { Finding } from '../../../../src/application/doctor/types.js';
import { Tally } from '../../../../src/application/tally.js';
import {
  workspaceToolScope,
  type WorkspaceToolScope,
} from '../../../../src/application/tool/scope.js';
import { harness, MANIFEST_DIR, type Harness } from '../../../fakes/workspace.js';

const workspace =
  'schema_version: 2\nproviders: {code-host: {provider: local-git, vars: {host: /host}}}\ndefaults: {branch: main, upstream_project: team}\nrepos: [{name: api}]\n';
const toolFindings = (h: Harness, scope: WorkspaceToolScope): Promise<Finding[]> =>
  Tally.during(h.activity, 'checks', (checks) => checkTools(h.deps, scope, checks));

describe('doctor tool scope', () => {
  it('does not probe unused baseline tools for a local-git workspace', async () => {
    const h = await harness({ workspace });
    const scope = workspaceToolScope(h.ctx, {});
    expect(scope.names).toEqual([]);
    expect(await toolFindings(h, scope)).toEqual([]);
    expect(h.process.calls).toEqual([]);
  });

  it('reports unreadable bindings while preserving known zero-tool coverage', async () => {
    const h = await harness({ workspace });
    expect(workspaceToolScope(h.ctx, {}).problems).toEqual([]);
    const unknown = await harness({ workspace: workspace.replace('local-git', 'nonesuch') });
    expect(workspaceToolScope(unknown.ctx, {}).problems).toMatchObject([
      {
        group: 'manifest',
        id: 'provider:code-host',
        level: 'fail',
        coverage: 'incomplete',
        message: expect.stringContaining('is not registered'),
      },
    ]);
    const mismatched = await harness({ workspace: workspace.replace('local-git', 'jenkins-cli') });
    expect(workspaceToolScope(mismatched.ctx, {}).problems).toMatchObject([
      { level: 'fail', coverage: 'incomplete', message: expect.stringContaining('does not serve') },
    ]);
  });

  it('checks a tool two bindings reach exactly once', async () => {
    const h = await harness({
      workspace: workspace.replace(
        'providers: {code-host: {provider: local-git, vars: {host: /host}}}',
        'providers: {code-host: {provider: local-git, vars: {host: /host}}, im: {provider: lark}, knowledge-base: {provider: lark-wiki, vars: {space: TEAM}}}',
      ),
    });
    const scope = workspaceToolScope(h.ctx, {});
    expect(scope.names).toEqual(['lark-cli']);
    expect(await toolFindings(h, scope)).toMatchObject([{ id: 'lark-cli' }]);
  });

  it('checks a tool the workspace named, whether or not it changed one of its fields', async () => {
    const h = await harness({
      workspace,
      files: {
        [`${MANIFEST_DIR}/manifest/tools.yaml`]: 'schema_version: 3\ntools: [{ name: lark-cli }]\n',
      },
    });
    const scope = workspaceToolScope(h.ctx, {});
    expect(scope.names).toEqual(['lark-cli']);
    expect(scope.required.has('lark-cli')).toBe(false);
  });

  it('allows explicit checks of an optional baseline tool', async () => {
    const h = await harness({ workspace });
    const scope = workspaceToolScope(h.ctx, { tools: ['bitbucket-cli'] });
    expect(await toolFindings(h, scope)).toMatchObject([
      { id: 'bitbucket-cli', level: 'fail', evidence: { required: true, state: 'missing' } },
    ]);
  });

  it("requires a bound provider's tool without the workspace declaring it", async () => {
    const h = await harness({ workspace: workspace.replace('local-git', 'bitbucket-cli') });
    const scope = workspaceToolScope(h.ctx, {});
    expect(await toolFindings(h, scope)).toMatchObject([
      { id: 'bitbucket-cli', level: 'fail', evidence: { required: true, active_dependency: true } },
    ]);
  });

  it.each([true, false])('honours explicit manifest required=%s', async (required) => {
    const h = await harness({
      workspace: workspace.replace('local-git', 'bitbucket-cli'),
      files: {
        [`${MANIFEST_DIR}/manifest/tools.yaml`]: `schema_version: 3\ntools: [{name: bitbucket-cli, required: ${required}}]\n`,
      },
    });
    const scope = workspaceToolScope(h.ctx, {});
    expect(await toolFindings(h, scope)).toMatchObject([
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
        workspace: active ? workspace.replace('local-git', 'bitbucket-cli') : workspace,
        files: {
          [`${MANIFEST_DIR}/manifest/tools.yaml`]: `schema_version: 3\ntools: [{name: bitbucket-cli, enabled: false, required: ${required}}]\n`,
        },
      });
      const scope = workspaceToolScope(h.ctx, {});
      expect(await toolFindings(h, scope)).toMatchObject([
        { id: 'bitbucket-cli', level, coverage, evidence: { required, active_dependency: active } },
      ]);
    },
  );

  it('checks required and optional manifest additions without enabling all baseline tools', async () => {
    const h = await harness({
      workspace,
      files: {
        [`${MANIFEST_DIR}/manifest/tools.yaml`]:
          'schema_version: 3\ntools: [{name: required-tool, required: true}, {name: optional-tool}]\n',
      },
    });
    const scope = workspaceToolScope(h.ctx, {});
    expect(await toolFindings(h, scope)).toMatchObject([
      { id: 'required-tool', level: 'fail' },
      { id: 'optional-tool', level: 'warn' },
    ]);
  });

  it('keeps inactive platform tools out of readiness and marks disabled active dependencies incomplete', async () => {
    const files = {
      [`${MANIFEST_DIR}/manifest/tools.yaml`]:
        'schema_version: 3\ntools: [{name: jenkins-cli, enabled: false}]\n',
      [`${MANIFEST_DIR}/manifest/environments.yaml`]:
        'schema_version: 2\nplatforms: {build: {provider: jenkins-cli, capability: ci}}\nenvs: {dev: {}, test: {platforms: {build: {}}}}\n',
    };
    const h = await harness({ workspace, local: { scope: { envs: ['dev'] } }, files });
    const inactive = workspaceToolScope(h.ctx, {});
    expect(await toolFindings(h, inactive)).toMatchObject([
      {
        id: 'jenkins-cli',
        level: 'ok',
        coverage: 'not_applicable',
        evidence: { required: false },
      },
    ]);
    const other = await harness({ workspace, files });
    const active = workspaceToolScope(other.ctx, { envs: ['test'] });
    expect(await toolFindings(other, active)).toMatchObject([
      { id: 'jenkins-cli', level: 'fail', coverage: 'incomplete', evidence: { required: true } },
    ]);
    const excluded = workspaceToolScope(other.ctx, { envs: ['dev'] });
    expect(excluded.required.has('jenkins-cli')).toBe(false);
  });
});
