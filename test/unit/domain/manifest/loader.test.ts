import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { providerCatalog } from '../../../../src/composition/registry.js';
import {
  loadEnvironments,
  loadLocal,
  loadMembers,
  loadTools,
  loadToolsDocument,
  loadWorkspace,
} from '../../../../src/domain/manifest/loader.js';
import { commandOrigin, resolveTools } from '../../../../src/domain/toolchain/resolve.js';

const text = (name: string): string =>
  readFileSync(path.resolve('test/fixtures/manifest', name), 'utf8');
const cli = { cliVersion: '1.0.0' };

describe('loadWorkspace', () => {
  it('loads a schema 1 document unchanged and reports nothing', () => {
    const result = loadWorkspace(text('v1-minimal/workspace.yaml'), cli);
    expect(result.problems).toEqual([]);
    expect(result.dropped).toEqual([]);
    expect(result.unknown).toEqual([]);
    expect(result.negotiation.schema).toBe(1);
    expect(result.doc.repos.map((r) => r.name)).toEqual([
      'fx-example-api',
      'fx-example-auth',
      'fx-example-docs',
    ]);
  });

  it('drops the unusable entries, keeps the rest, and says why with a line number', () => {
    const result = loadWorkspace(text('broken/entry.yaml'), cli);
    expect(result.doc.repos.map((r) => r.name)).toEqual(['good-one', 'good-two']);
    expect(result.dropped).toEqual([
      { collection: 'repos', name: 'repos[1]', reason: expect.stringContaining('name') },
      { collection: 'repos', name: 'escapes', reason: expect.stringContaining('path') },
    ]);
    expect(result.problems.map((p) => p.path)).toEqual(['repos[1].name', 'repos[2].path']);
    expect(result.problems[1]?.line).toBe(7);
  });

  it('fails when every entry was dropped but not when the list was empty on purpose', () => {
    expect(() => loadWorkspace(text('broken/all-entries-bad.yaml'), cli)).toThrow(
      expect.objectContaining({ category: 'config', code: 'MANIFEST_UNUSABLE' }),
    );
    expect(() => loadWorkspace(text('broken/empty-repos.yaml'), cli)).toThrow(
      expect.objectContaining({ code: 'MANIFEST_INVALID' }),
    );
  });

  it('treats a missing schema_version as a document-level failure', () => {
    expect(() => loadWorkspace(text('broken/no-schema-version.yaml'), cli)).toThrow(
      expect.objectContaining({ code: 'MANIFEST_INVALID' }),
    );
  });

  it('reports unknown keys, and only under strict turns them into errors', () => {
    const lenient = loadWorkspace(text('broken/unknown-keys.yaml'), cli);
    expect(lenient.unknown).toEqual(['colour', 'repos[0].owner']);
    expect(lenient.problems).toEqual([]);
    expect(lenient.doc.repos).toHaveLength(1);
    expect(() => loadWorkspace(text('broken/unknown-keys.yaml'), { ...cli, strict: true })).toThrow(
      expect.objectContaining({ code: 'MANIFEST_INVALID' }),
    );
  });

  it('returns the full problem list instead of dropping or throwing under allowInvalid', () => {
    const result = loadWorkspace(text('broken/entry.yaml'), { ...cli, allowInvalid: true });
    expect(result.dropped).toEqual([]);
    expect(result.problems).toHaveLength(2);
    const all = loadWorkspace(text('broken/all-entries-bad.yaml'), { ...cli, allowInvalid: true });
    expect(all.problems.length).toBeGreaterThan(0);
  });

  it('surfaces a negotiation failure as a thrown error, or as a problem under allowInvalid', () => {
    const tooNew = text('v1-minimal/workspace.yaml').replace(
      'schema_version: 1',
      'schema_version: 9',
    );
    expect(() => loadWorkspace(tooNew, cli)).toThrow(
      expect.objectContaining({ code: 'MANIFEST_SCHEMA_TOO_NEW' }),
    );
    const reported = loadWorkspace(tooNew, { ...cli, allowInvalid: true });
    expect(reported.negotiation.failure).toBe('schema_too_new');
    expect(reported.problems[0]?.path).toBe('schema_version');
  });

  it('reports a malformed min_cli as invalid manifest content', () => {
    const invalid = text('v1-minimal/workspace.yaml').replace(
      'schema_version: 1',
      'schema_version: 1\nmin_cli: bananas',
    );
    expect(() => loadWorkspace(invalid, cli)).toThrow(
      expect.objectContaining({ code: 'MANIFEST_INVALID' }),
    );
  });

  it('rejects a YAML syntax error as a document problem with a line', () => {
    expect(() => loadWorkspace('schema_version: 1\nrepos:\n  - name: [unclosed\n', cli)).toThrow(
      expect.objectContaining({ code: 'MANIFEST_INVALID' }),
    );
  });

  it('requires a git host on schema 1 unless every repository names its upstream', () => {
    const noHost = text('v1-minimal/workspace.yaml').replace(
      '  host: ssh://git@git.example.com:12345\n',
      '',
    );
    const result = loadWorkspace(noHost, { ...cli, allowInvalid: true });
    expect(result.problems.map((p) => p.path)).toContain('defaults.host');
  });

  it('requires every checkout to be a distinct, non-overlapping child of the workspace root', () => {
    const workspace = (paths: readonly string[]): string =>
      [
        'schema_version: 1',
        'defaults: { host: ssh://git@git.example.com, branch: main }',
        'repos:',
        ...paths.map((checkout, index) => `  - { name: repo-${index}, path: "${checkout}" }`),
      ].join('\n');

    for (const checkout of ['', '.', '..', '../outside', 'C:\\repo', '\\\\server\\repo']) {
      expect(loadWorkspace(workspace([checkout]), { ...cli, allowInvalid: true }).problems).toEqual(
        [expect.objectContaining({ path: 'repos[0].path' })],
      );
    }
    expect(
      loadWorkspace(workspace(['apps', 'apps/service']), { ...cli, allowInvalid: true }).problems,
    ).toEqual([
      expect.objectContaining({
        path: 'repos[1].path',
        message: expect.stringContaining('overlaps'),
      }),
    ]);
  });
});

describe('loadEnvironments', () => {
  it('loads the real-world shape and does not quarantine', () => {
    const result = loadEnvironments(text('v1-real-shape/environments.yaml'), cli);
    expect(result.problems).toEqual([]);
    expect(Object.keys(result.doc.envs)).toEqual(['dev', 'prod', 'selfhosted']);
  });

  it('fails when an environment configures an undeclared platform', () => {
    const doc = text('v1-real-shape/environments.yaml').replace(
      "      jenkins: { vars: { path: 'oem/{repo}/release' } }",
      '      grafana: { vars: { path: x } }',
    );
    expect(() => loadEnvironments(doc, cli)).toThrow(
      expect.objectContaining({ code: 'MANIFEST_INVALID' }),
    );
    const reported = loadEnvironments(doc, { ...cli, allowInvalid: true });
    expect(reported.problems.map((p) => p.path)).toEqual(['envs.selfhosted.platforms.grafana']);
  });

  it('checks repository overrides against the declared platforms and environments', () => {
    const workspace = loadWorkspace(text('v1-real-shape/workspace.yaml'), cli).doc;
    const ok = loadEnvironments(text('v1-real-shape/environments.yaml'), cli, { workspace });
    expect(ok.problems).toEqual([]);
    const other = loadWorkspace(
      text('v1-real-shape/workspace.yaml').replace(
        'prod: { vars: { slug: fx-example-data-prod }',
        'staging: { vars: { slug: fx-example-data-prod }',
      ),
      cli,
    ).doc;
    const bad = loadEnvironments(
      text('v1-real-shape/environments.yaml'),
      { ...cli, allowInvalid: true },
      { workspace: other },
    );
    expect(bad.problems.map((p) => p.path)).toEqual(['repos[1].obs.overrides.sentry.staging']);
  });

  it('checks the release policy against the declared environments', () => {
    const workspace = loadWorkspace(
      text('v2-full/workspace.yaml')
        .replace('env: test', 'env: staging')
        .replace('target_env: selfhosted', 'target_env: prod'),
      cli,
    ).doc;
    const bad = loadEnvironments(
      text('v2-full/environments.yaml'),
      { ...cli, allowInvalid: true },
      { workspace },
    );
    expect(bad.problems.map((p) => p.path)).toEqual(['release.env', 'release.ci.target_env']);
  });

  it('refuses a release with no target branch to land on', () => {
    const doc = text('v2-full/workspace.yaml').replace('  env: test\n', '  targets: []\n');
    expect(loadWorkspace(doc, { ...cli, allowInvalid: true }).problems.map((p) => p.path)).toEqual([
      'release.targets',
    ]);
  });

  it('checks a service block only against a catalog it was given', () => {
    const doc =
      'schema_version: 2\nproviders:\n  code-host: {provider: bitbucket-cli, vars: {host: "ssh://git@git.example.com"}, service: {base_url: "https://git.example.com", auth_scheme: token}}\nrepos: [{name: a, branch: main}]\n';
    expect(
      loadWorkspace(doc, { ...cli, providers: providerCatalog(), allowInvalid: true }).problems.map(
        (p) => p.path,
      ),
    ).toEqual(['providers.code-host.service.context', 'providers.code-host.service.auth_scheme']);
    expect(loadWorkspace(doc, { ...cli, allowInvalid: true }).problems).toEqual([]);
  });

  it('refuses a release window it cannot read', () => {
    const doc = text('v2-full/workspace.yaml').replace('  env: test\n', '  since: soon\n');
    expect(loadWorkspace(doc, { ...cli, allowInvalid: true }).problems.map((p) => p.path)).toEqual([
      'release.since',
    ]);
  });
});

describe('loadMembers', () => {
  it('loads a sensitive document', () => {
    const result = loadMembers(text('v1-real-shape/members.yaml'), cli);
    expect(result.problems).toEqual([]);
    expect(result.doc.people).toHaveLength(2);
  });

  it('refuses a document that is not marked sensitive with its own code', () => {
    expect(() => loadMembers(text('broken/members-not-sensitive.yaml'), cli)).toThrow(
      expect.objectContaining({ code: 'MEMBERS_NOT_SENSITIVE' }),
    );
  });

  it('fails on a reference to an unknown person, allowing the reserved id all', () => {
    const doc = text('v1-real-shape/members.yaml').replace('dev_lead: alice', 'dev_lead: carol');
    const result = loadMembers(doc, { ...cli, allowInvalid: true });
    expect(result.problems.map((p) => p.path)).toEqual(['areas[0].scenarios[0].dev_lead']);
  });
});

describe('loadToolsDocument', () => {
  it('returns an explicit invalid state instead of casting a malformed document', () => {
    const result = loadToolsDocument('schema_version: 2\ntools: nope\n', {
      ...cli,
      allowInvalid: true,
    });
    expect(result).toMatchObject({ valid: false, doc: null });
    expect(result.problems).toEqual([expect.objectContaining({ path: 'tools' })]);
  });

  it('rejects an interpreter as a binary and a shell-looking argument', () => {
    const doc = [
      'schema_version: 2',
      'defaults: { install: [{ via: npm }] }',
      'tools:',
      '  - name: bash',
      '  - name: ok-tool',
      '    auth: { command: ["auth", "status; rm -rf /"] }',
    ].join('\n');
    const result = loadToolsDocument(doc, { ...cli, allowInvalid: true });
    expect(result.problems.map((p) => p.path)).toEqual([
      'tools[0].name',
      'tools[1].auth.command[1]',
    ]);
  });

  it('quarantines a tool without any install method', () => {
    const doc = [
      'schema_version: 2',
      'tools:',
      '  - name: lonely',
      '  - name: fine',
      '    install: [{ via: brew, spec: fine }]',
    ].join('\n');
    const result = loadToolsDocument(doc, cli);
    expect(result.dropped.map((d) => d.name)).toEqual(['lonely']);
    expect(result.doc.tools.map((t) => t.name)).toEqual(['fine']);
  });
});

describe('loadLocal', () => {
  it('loads the personal layer without negotiation', () => {
    const result = loadLocal(text('local/local.yaml'));
    expect(result.problems).toEqual([]);
    expect(result.doc.scope?.repos).toEqual(['fx-example-api', 'fx-example-auth']);
  });

  it('refuses a shared field inside an override', () => {
    expect(() => loadLocal(text('local/leaks-shared-field.yaml'))).toThrow(
      expect.objectContaining({ code: 'LOCAL_INVALID' }),
    );
  });
});

describe('loadTools opt-in selection', () => {
  const bundled = (): string => readFileSync(path.resolve('defaults/tools.yaml'), 'utf8');
  const names = (patch: string | undefined): string[] => {
    const result = loadTools(bundled(), patch, cli);
    if (!result.valid) throw new Error(result.problems.map((p) => p.message).join('; '));
    return result.doc.tools.map((tool) => tool.name);
  };

  it('keeps an opt-in tool out of a workspace that never names it', () => {
    const baseline = names(undefined);
    expect(baseline).not.toContain('jenkins-cli');
    expect(baseline).toContain('bitbucket-cli');
    // An unrelated declaration must not decide anything about the others.
    expect(names('schema_version: 2\ntools: [{ name: bitbucket-cli }]\n')).toEqual(baseline);
  });

  it('joins an opt-in tool a workspace names, vouching for what it did not change', () => {
    const result = loadTools(bundled(), 'schema_version: 2\ntools: [{ name: jenkins-cli }]\n', cli);
    if (!result.valid) throw new Error('patch rejected');
    const [tool] = resolveTools(result.doc, result.provenance, result.declared).filter(
      (item) => item.name === 'jenkins-cli',
    );
    expect(tool?.declared).toBe(true);
    expect(tool?.install).toEqual([{ via: 'npm', spec: '@angelmsger/jenkins-cli' }]);
    expect(commandOrigin(tool!)).toBe('base');
    expect(tool?.patchedFields).toEqual([]);
  });

  it('refuses a workspace that decides what the baseline ships', () => {
    const result = loadTools(
      bundled(),
      'schema_version: 2\ntools: [{ name: jenkins-cli, opt_in: false }]\n',
      { ...cli, allowInvalid: true },
    );
    expect(result.problems).toContainEqual(expect.objectContaining({ path: 'tools[0].opt_in' }));
  });
});
