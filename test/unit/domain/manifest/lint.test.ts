import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { providerCatalog } from '../../../../src/composition/registry.js';
import { lintManifest } from '../../../../src/domain/manifest/lint.js';
import {
  loadEnvironments,
  loadToolsDocument,
  loadWorkspace,
} from '../../../../src/domain/manifest/loader.js';
import type { Workspace } from '../../../../src/domain/manifest/types.js';

const text = (name: string): string =>
  readFileSync(path.resolve('test/fixtures/manifest', name), 'utf8');
const cli = { cliVersion: '1.0.0' };
const codes = (findings: readonly { code: string }[]): string[] => findings.map((f) => f.code);
const providers = providerCatalog();

describe('lintManifest', () => {
  it('reports uncovered shared repositories only when ownership data was read', () => {
    const workspace = loadWorkspace(text('v2-full/workspace.yaml'), cli).doc;
    expect(codes(lintManifest({ providers, workspace }))).not.toContain('REPO_NO_OWNER');
    const findings = lintManifest({ providers, workspace, ownedRepos: ['fx-example-api'] }).filter(
      (f) => f.code === 'REPO_NO_OWNER',
    );
    expect(findings.map((f) => f.path)).toEqual(
      workspace.repos.flatMap((repo, i) => (repo.name === 'fx-example-api' ? [] : [`repos[${i}]`])),
    );
    expect(
      lintManifest({
        providers,
        workspace,
        ownedRepos: workspace.repos.map((repo) => repo.name),
      }).filter((f) => f.code === 'REPO_NO_OWNER'),
    ).toEqual([]);
  });

  it.each(['', '  \t'])('treats a blank project contact as missing', (contact) => {
    const workspace = loadWorkspace(text('v2-full/workspace.yaml'), cli).doc;
    const findings = lintManifest({
      providers,
      workspace: { ...workspace, projects: { fx: { contact } } },
    });
    expect(findings).toContainEqual(
      expect.objectContaining({ code: 'PROJECT_NO_CONTACT', path: 'projects.fx' }),
    );
  });

  it('checks declared provider setup hints independently of platform names and ignores uncovered environments', () => {
    const workspace = loadWorkspace(text('v2-full/workspace.yaml'), cli).doc;
    const environments = loadEnvironments(
      'schema_version: 2\nplatforms:\n  remote-access: {provider: file-access, capability: cluster}\n  kube: {provider: automatic-access, capability: cluster}\nenvs:\n  dev:\n    label: Development\n    platforms:\n      remote-access: {setup: {download: " "}}\n      kube: {}\n  absent: {label: Absent}\n  off:\n    label: Disabled\n    platforms:\n      remote-access: {confidence: not_covered}\n',
      cli,
    ).doc;
    const input = {
      providers,
      workspace,
      environments,
      providerSetupHints: { 'file-access': ['download'] },
    };
    expect(lintManifest(input).filter((f) => f.code === 'PLATFORM_NO_SETUP')).toEqual([
      expect.objectContaining({
        path: 'envs.dev.platforms.remote-access.setup',
        message: expect.stringContaining('download'),
      }),
    ]);
    const dev = environments.envs['dev']!;
    const ready = {
      ...environments,
      envs: {
        ...environments.envs,
        dev: {
          ...dev,
          platforms: {
            ...dev.platforms,
            'remote-access': { setup: { download: 'https://docs.example.com/access' } },
          },
        },
      },
    };
    expect(
      lintManifest({ ...input, environments: ready }).filter((f) => f.code === 'PLATFORM_NO_SETUP'),
    ).toEqual([]);
  });

  it('has nothing to say about a clean schema 2 workspace', () => {
    const workspace = loadWorkspace(text('v2-full/workspace.yaml'), cli).doc;
    const environments = loadEnvironments(text('v2-full/environments.yaml'), cli).doc;
    expect(lintManifest({ providers, workspace, environments })).toEqual([]);
  });

  it('suggests providers on a schema 1 document and nothing else on a tidy one', () => {
    const workspace = loadWorkspace(text('v1-minimal/workspace.yaml'), cli).doc;
    expect(lintManifest({ providers, workspace })).toEqual([
      expect.objectContaining({ kind: 'workspace', code: 'PROVIDERS_MISSING', path: 'providers' }),
    ]);
  });

  it('flags fields that restate a default', () => {
    const workspace: Workspace = {
      schema_version: 2,
      providers: {
        'code-host': { provider: 'bitbucket-cli', vars: { host: 'ssh://git@git.example.com' } },
      },
      defaults: { upstream_project: 'fx', branch: 'dev' },
      projects: { fx: { contact: '#fx' } },
      repos: [{ name: 'a', path: 'a', branch: 'dev', project: 'fx' }],
    };
    const findings = lintManifest({ providers, workspace });
    expect(findings.map((f) => f.path)).toEqual([
      'repos[0].path',
      'repos[0].branch',
      'repos[0].project',
    ]);
    expect(new Set(codes(findings))).toEqual(new Set(['REDUNDANT_FIELD']));
  });

  it('checks projects: undeclared, unused, and without a contact', () => {
    const workspace: Workspace = {
      schema_version: 2,
      providers: {
        'code-host': { provider: 'bitbucket-cli', vars: { host: 'ssh://git@git.example.com' } },
      },
      defaults: { branch: 'dev' },
      projects: { fx: { label: 'Platform' }, old: { contact: '#old' } },
      repos: [
        { name: 'a', project: 'fx' },
        { name: 'b', project: 'ghost' },
      ],
    };
    const findings = lintManifest({ providers, workspace });
    expect(findings.map((f) => [f.code, f.path])).toEqual([
      ['PROJECT_UNDECLARED', 'repos[1].project'],
      ['PROJECT_NO_CONTACT', 'projects.fx'],
      ['PROJECT_UNUSED', 'projects.old'],
    ]);
  });

  it('asks for a label on an unlabelled environment', () => {
    const environments = loadEnvironments(
      text('v2-full/environments.yaml').replace('    label: Self-hosted\n', ''),
      cli,
    ).doc;
    const workspace = loadWorkspace(text('v2-full/workspace.yaml'), cli).doc;
    expect(lintManifest({ providers, workspace, environments })).toEqual([
      expect.objectContaining({
        kind: 'environments',
        code: 'ENV_NO_LABEL',
        path: 'envs.selfhosted',
      }),
    ]);
  });

  it('points out a patch field that only repeats the baseline', () => {
    const base = loadToolsDocument(
      [
        'schema_version: 2',
        'defaults: { install: [{ via: npm }] }',
        'tools:',
        '  - name: x',
        '    desc: same',
        '    min_version: 1.0.0',
      ].join('\n'),
      cli,
    ).doc;
    const patch = loadToolsDocument(
      [
        'schema_version: 2',
        'tools:',
        '  - name: x',
        '    desc: same',
        '    min_version: 2.0.0',
        '    install: [{ via: npm }]',
      ].join('\n'),
      cli,
    ).doc;
    const workspace = loadWorkspace(text('v2-full/workspace.yaml'), cli).doc;
    const findings = lintManifest({ providers, workspace, tools: { base, patch } });
    expect(findings.map((f) => [f.code, f.path])).toEqual([['PATCH_NOOP', 'tools[0].desc']]);
  });

  it('says when a release block names no environment for errors', () => {
    const workspace = loadWorkspace(
      text('v2-full/workspace.yaml').replace('  env: test\n', ''),
      cli,
    ).doc;
    const environments = loadEnvironments(text('v2-full/environments.yaml'), cli).doc;
    expect(
      lintManifest({ providers, workspace, environments }).map((f) => [f.code, f.path]),
    ).toEqual([['RELEASE_ENV_UNSET', 'release.env']]);
  });

  it('names the checklist repositories whose errors fx release cannot see', () => {
    const workspace = loadWorkspace(
      text('v2-full/workspace.yaml')
        .replace('    obs: { svc: example-api }\n', '    obs: { covered: false }\n')
        .replace('    branch: main\n', '    branch: main\n    release: { covered: false }\n'),
      cli,
    ).doc;
    const environments = loadEnvironments(text('v2-full/environments.yaml'), cli).doc;
    expect(
      lintManifest({ providers, workspace, environments }).map((f) => [f.code, f.path]),
    ).toEqual([['RELEASE_COVERAGE_GAP', 'repos[0].release']]);
  });

  it('counts an environment that declares its tracker uncovered as a gap for everyone', () => {
    const workspace = loadWorkspace(text('v2-full/workspace.yaml'), cli).doc;
    const environments = loadEnvironments(
      text('v2-full/environments.yaml').replace(
        "      sentry: { vars: { team: fx-test, slug: 'fx-{svc}-test' } }",
        '      sentry: { confidence: not_covered }',
      ),
      cli,
    ).doc;
    expect(new Set(codes(lintManifest({ providers, workspace, environments })))).toEqual(
      new Set(['RELEASE_COVERAGE_GAP']),
    );
  });

  it('counts a repository whose tracker entry says not_covered as a gap too', () => {
    const workspace = loadWorkspace(
      text('v2-full/workspace.yaml')
        .replace(
          '    obs: { svc: example-api }\n',
          '    obs:\n      svc: example-api\n      overrides:\n        sentry:\n          test: { confidence: not_covered }\n',
        )
        .replace('    branch: main\n', '    branch: main\n    release: { covered: false }\n'),
      cli,
    ).doc;
    const environments = loadEnvironments(text('v2-full/environments.yaml'), cli).doc;
    expect(lintManifest({ providers, workspace, environments }).map((f) => f.code)).toEqual([
      'RELEASE_COVERAGE_GAP',
    ]);
  });
});
