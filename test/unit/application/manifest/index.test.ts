import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { LintManifest } from '../../../../src/application/manifest/lint.js';
import {
  locateManifestDir,
  resolveManifestDir,
} from '../../../../src/application/manifest/locate.js';
import { ProvidersManifest } from '../../../../src/application/manifest/providers.js';
import { SetRepoField } from '../../../../src/application/manifest/set.js';
import { ValidateManifest } from '../../../../src/application/manifest/validate.js';
import type { WritePosture } from '../../../../src/application/safety/posture.js';
import { providerCatalog } from '../../../../src/composition/registry.js';
import type { SetupRecipe } from '../../../../src/domain/setup/types.js';
import { bundledTools } from '../../../bundled-tools.js';
import { FakeConfigStore } from '../../../fakes/fake-config-store.js';
import { FakeFs } from '../../../fakes/fake-fs.js';
import { FakeReporter } from '../../../fakes/fake-reporter.js';

const fixture = (name: string): string =>
  readFileSync(path.resolve('test/fixtures/manifest', name), 'utf8');
const writable: WritePosture = { readOnly: false, source: 'default' };
const locked: WritePosture = { readOnly: true, source: 'env' };
const cli = '1.0.0';

function workspace(kind: 'v2-full' | 'v1-minimal' | 'broken'): FakeFs {
  if (kind === 'broken') {
    return FakeFs.from({
      [path.resolve('/w/manifest/workspace.yaml')]: fixture('broken/entry.yaml'),
    });
  }
  if (kind === 'v1-minimal') {
    return FakeFs.from({
      [path.resolve('/w/manifest/workspace.yaml')]: fixture('v1-minimal/workspace.yaml'),
    });
  }
  return FakeFs.from({
    [path.resolve('/w/manifest/workspace.yaml')]: fixture('v2-full/workspace.yaml'),
    [path.resolve('/w/manifest/environments.yaml')]: fixture('v2-full/environments.yaml'),
    [path.resolve('/w/manifest/tools.yaml')]: fixture('v2-full/tools.yaml'),
    [path.resolve('/w/manifest/members.yaml')]: fixture('v2-full/members.yaml'),
  });
}

describe('locateManifestDir', () => {
  it('walks up from a nested directory to the directory holding manifest/workspace.yaml', async () => {
    expect(
      await locateManifestDir(workspace('v2-full'), path.resolve('/w/fx-example-api/src/deep')),
    ).toBe(path.resolve('/w'));
    expect(await locateManifestDir(workspace('v2-full'), path.resolve('/w'))).toBe(
      path.resolve('/w'),
    );
    expect(await locateManifestDir(FakeFs.from({}), path.resolve('/elsewhere'))).toBeUndefined();
  });
});

describe('resolveManifestDir', () => {
  const manifestDirFor = (name: string): string => `/home/.fx/workspaces/${name}/source`;
  const input = (cwd: string, fs: FakeFs) => ({
    cwd,
    config: new FakeConfigStore({ workspaces: { fx: { root: path.resolve('/ws/fx') } } }),
    fs,
    reporter: new FakeReporter(),
    manifestDirFor,
  });

  it('prefers a checkout around cwd, then the registered workspace, then fails', async () => {
    expect(await resolveManifestDir(input(path.resolve('/w/deep'), workspace('v2-full')))).toBe(
      path.resolve('/w'),
    );
    expect(
      await resolveManifestDir(input(path.resolve('/ws/fx/fx-example-api'), FakeFs.from({}))),
    ).toBe(manifestDirFor('fx'));
    await expect(
      resolveManifestDir(input(path.resolve('/elsewhere'), FakeFs.from({}))),
    ).rejects.toMatchObject({
      category: 'not_found',
      code: 'WORKSPACE_NOT_FOUND',
      nextSteps: expect.arrayContaining(['fx workspace list']),
    });
  });

  it('honours explicit workspace selection before a nearby manifest and never falls back for unknown names', async () => {
    const selected = { ...input(path.resolve('/w/deep'), workspace('v2-full')), name: 'fx' };
    expect(await resolveManifestDir(selected)).toBe(manifestDirFor('fx'));
    await expect(resolveManifestDir({ ...selected, name: 'missing' })).rejects.toMatchObject({
      code: 'WORKSPACE_UNKNOWN',
    });
  });
});

describe('ValidateManifest', () => {
  it('reports every present document as ok on a clean workspace', async () => {
    const report = await new ValidateManifest(workspace('v2-full'), bundledTools).execute({
      dir: path.resolve('/w'),
      cliVersion: cli,
      providers: providerCatalog(),
      strict: true,
    });
    expect(report.ok).toBe(true);
    expect(report.documents.map((d) => [d.kind, d.present])).toEqual([
      ['workspace', true],
      ['environments', true],
      ['tools', true],
      ['members', true],
      ['harness', false],
    ]);
  });

  it.each([false, true])(
    'fails absent required workspace documents with strict=%s',
    async (strict) => {
      const report = await new ValidateManifest(FakeFs.from({}), bundledTools).execute({
        dir: path.resolve('/w'),
        cliVersion: cli,
        providers: providerCatalog(),
        strict,
      });
      expect(report.ok).toBe(false);
      expect(report.documents[0]).toMatchObject({
        kind: 'workspace',
        present: false,
        problems: [{ path: '(root)', message: 'Required manifest/workspace.yaml is missing.' }],
      });
      expect(
        report.documents
          .filter((doc) => doc.kind !== 'workspace')
          .every((doc) => doc.problems.length === 0),
      ).toBe(true);
    },
  );

  it('accepts missing optional documents in strict mode', async () => {
    const report = await new ValidateManifest(workspace('v1-minimal'), bundledTools).execute({
      dir: path.resolve('/w'),
      cliVersion: cli,
      providers: providerCatalog(),
      strict: true,
    });
    expect(report.ok).toBe(true);
    expect(report.documents.filter((doc) => !doc.present).map((doc) => doc.kind)).toEqual([
      'environments',
      'members',
      'harness',
    ]);
  });

  it('lists problems without throwing and marks the report not ok', async () => {
    const report = await new ValidateManifest(workspace('broken'), bundledTools).execute({
      dir: path.resolve('/w'),
      cliVersion: cli,
      providers: providerCatalog(),
      strict: false,
    });
    expect(report.ok).toBe(false);
    const ws = report.documents.find((d) => d.kind === 'workspace');
    expect(ws?.problems.map((p) => p.path)).toEqual(['repos[1].name', 'repos[2].path']);
    expect(report.documents.find((d) => d.kind === 'environments')?.present).toBe(false);
  });

  it('restricts itself to one kind when asked', async () => {
    const report = await new ValidateManifest(workspace('v2-full'), bundledTools).execute({
      dir: path.resolve('/w'),
      cliVersion: cli,
      providers: providerCatalog(),
      strict: false,
      kind: 'tools',
    });
    expect(report.documents.map((d) => d.kind)).toEqual(['tools']);
  });

  it('keeps the schema path when a tools document has the wrong root shape', async () => {
    const fs = workspace('v1-minimal');
    await fs.writeText(path.resolve('/w/manifest/tools.yaml'), 'schema_version: 3\ntools: nope\n');
    const report = await new ValidateManifest(fs, bundledTools).execute({
      dir: path.resolve('/w'),
      cliVersion: cli,
      providers: providerCatalog(),
      strict: false,
      kind: 'tools',
    });
    expect(report.ok).toBe(false);
    expect(report.documents[0]?.problems).toEqual([expect.objectContaining({ path: 'tools' })]);
  });
});

describe('LintManifest', () => {
  it('projects ownership and provider recipe hints without exposing people or requiring live checks', async () => {
    const fs = FakeFs.from({
      [path.resolve('/w/manifest/workspace.yaml')]:
        'schema_version: 2\ndefaults: {host: "https://git.example.com", upstream_project: fx, branch: dev}\nrepos: [{name: one}, {name: two}]\n',
      [path.resolve('/w/manifest/environments.yaml')]:
        'schema_version: 2\nplatforms:\n  remote: {provider: file-access, capability: cluster}\nenvs:\n  dev: {label: Development, platforms: {remote: {}}}\n',
      [path.resolve('/w/manifest/members.yaml')]:
        'schema_version: 1\nsensitive: true\npeople: []\nareas:\n  - group: platform\n    scenarios: [{name: base, repos: [one]}]\n',
    });
    const recipes: readonly SetupRecipe[] = [
      {
        id: 'config',
        tool: 'file-access',
        perEnv: true,
        kind: 'file',
        title: 'Configuration',
        open: '{setup.download}',
        verify: { file: '~/config' },
      },
      {
        id: 'manual',
        tool: 'file-access',
        perEnv: true,
        kind: 'manual',
        title: 'Access',
        instructions: 'See {setup.guide}',
        defaults: { 'setup.guide': 'https://docs.example.com/access' },
        verify: { command: ['check'] },
      },
      {
        id: 'run',
        tool: 'file-access',
        perEnv: true,
        kind: 'run',
        phase: 'prepare',
        title: 'Automatic',
        instructions: '{setup.automatic}',
        run: ['check'],
        verify: { command: ['check'] },
      },
    ];
    const findings = await new LintManifest({
      fs,
      bundledTools,
      describeProvider: (id) => (id === 'file-access' ? { recipes } : undefined),
    }).execute({ dir: path.resolve('/w'), cliVersion: cli, providers: providerCatalog() });
    expect(findings.filter((f) => f.code === 'MANIFEST_INVALID')).toEqual([]);
    expect(findings.filter((f) => f.code === 'REPO_NO_OWNER')).toEqual([
      expect.objectContaining({ path: 'repos[1]' }),
    ]);
    expect(findings.filter((f) => f.code === 'PLATFORM_NO_SETUP')).toEqual([
      expect.objectContaining({
        path: 'envs.dev.platforms.remote.setup',
        message: expect.stringContaining('download'),
      }),
    ]);
    expect(findings.filter((f) => f.code === 'PLATFORM_NO_SETUP')[0]?.message).not.toContain(
      'guide',
    );
    expect(fs.writes).toEqual([]);
  });

  it('returns the findings of the documents that exist', async () => {
    const findings = await new LintManifest({ fs: workspace('v1-minimal'), bundledTools }).execute({
      dir: path.resolve('/w'),
      cliVersion: cli,
      providers: providerCatalog(),
    });
    expect(findings.map((f) => f.code)).toEqual(['PROVIDERS_MISSING']);
  });

  it('checks every team Skill directory of the checkout', async () => {
    const fs = workspace('v2-full');
    await fs.writeText(
      path.resolve('/w/skills/review/SKILL.md'),
      '---\nname: review\ndescription: x\n---\n',
    );
    await fs.writeText(path.resolve('/w/skills/bad/SKILL.md'), '---\nname: other\n---\n');
    await fs.writeText(path.resolve('/w/skills/README.md'), 'not a Skill\n');
    fs.mkdir(path.resolve('/w/skills/empty'));
    const findings = await new LintManifest({ fs, bundledTools }).execute({
      dir: path.resolve('/w'),
      cliVersion: cli,
      providers: providerCatalog(),
    });
    expect(findings.filter((f) => f.kind === 'skills').map((f) => [f.code, f.path])).toEqual([
      ['SKILL_NAME_MISMATCH', 'skills/bad/SKILL.md'],
      ['SKILL_WITHOUT_DESCRIPTION', 'skills/bad/SKILL.md'],
      ['SKILL_WITHOUT_SKILL_MD', 'skills/empty/SKILL.md'],
    ]);
  });

  it('lints sparse tools overlays using inherited requirements and supports field deletions', async () => {
    const fs = workspace('v1-minimal');
    await fs.writeText(
      path.resolve('/w/manifest/tools.yaml'),
      'schema_version: 3\ntools: [{name: jenkins-cli, required: false}, {name: bitbucket-cli, min_version: null}]\n',
    );
    const findings = await new LintManifest({ fs, bundledTools }).execute({
      dir: path.resolve('/w'),
      cliVersion: cli,
      providers: providerCatalog(),
    });
    expect(findings.filter((finding) => finding.kind === 'tools')).toEqual([]);
  });

  it('reports an invalid tools document and skips semantic tool lint', async () => {
    const fs = workspace('v1-minimal');
    await fs.writeText(path.resolve('/w/manifest/tools.yaml'), 'schema_version: 3\ntools: nope\n');
    const findings = await new LintManifest({ fs, bundledTools }).execute({
      dir: path.resolve('/w'),
      cliVersion: cli,
      providers: providerCatalog(),
    });
    expect(findings).toContainEqual(
      expect.objectContaining({ kind: 'tools', code: 'MANIFEST_INVALID', path: 'tools' }),
    );
  });
});

describe('ProvidersManifest', () => {
  it('lists the bindings of the workspace', async () => {
    const bindings = await new ProvidersManifest(workspace('v1-minimal'), bundledTools).execute({
      dir: path.resolve('/w'),
      cliVersion: cli,
      providers: providerCatalog(),
    });
    expect(bindings.find((b) => b.capability === 'code-host')).toMatchObject({
      provider: 'bitbucket-cli',
      source: 'default',
    });
  });
});

describe('SetRepoField', () => {
  it('reads an alias list from its flow spelling and writes it as a sequence', async () => {
    const fs = workspace('v2-full');
    const result = await editor(fs).execute({
      dir: path.resolve('/w'),
      cliVersion: cli,
      providers: providerCatalog(),
      repo: 'fx-example-auth',
      field: 'aka',
      value: '[platform, accounts]',
      dryRun: false,
      posture: writable,
    });
    expect(result).toMatchObject({ before: null, after: '["platform","accounts"]', written: true });
    expect(await fs.readText(path.resolve('/w/manifest/workspace.yaml'))).toContain(
      'aka: ["platform","accounts"]',
    );
  });

  it('previews under dry-run without writing', async () => {
    const fs = workspace('v2-full');
    const result = await editor(fs).execute({
      dir: path.resolve('/w'),
      cliVersion: cli,
      providers: providerCatalog(),
      repo: 'fx-example-api',
      field: 'branch',
      value: 'feature/x',
      dryRun: true,
      posture: locked,
    });
    expect(result).toMatchObject({
      repo: 'fx-example-api',
      field: 'branch',
      before: null,
      after: 'feature/x',
      written: false,
    });
    expect(result.preview.join('\n')).toContain('+    branch: feature/x');
    expect(fs.writes).toEqual([]);
  });

  it('refuses under read-only posture and writes otherwise', async () => {
    const fs = workspace('v2-full');
    const input = {
      dir: path.resolve('/w'),
      cliVersion: cli,
      providers: providerCatalog(),
      repo: 'fx-example-auth',
      field: 'branch',
      value: 'release',
      dryRun: false,
    };
    await expect(editor(fs).execute({ ...input, posture: locked })).rejects.toMatchObject({
      code: 'READONLY_BLOCKED',
    });
    const result = await editor(fs).execute({ ...input, posture: writable });
    expect(result).toMatchObject({ before: 'main', after: 'release', written: true });
    expect(fs.writes).toEqual([path.normalize(path.resolve('/w/manifest/workspace.yaml'))]);
    expect(await fs.readText(path.resolve('/w/manifest/workspace.yaml'))).toContain(
      'branch: release',
    );
  });

  it('refuses an edit that would make the manifest invalid', async () => {
    const fs = workspace('v2-full');
    await expect(
      editor(fs).execute({
        dir: path.resolve('/w'),
        cliVersion: cli,
        providers: providerCatalog(),
        repo: 'fx-example-auth',
        field: 'path',
        value: '../outside',
        dryRun: false,
        posture: writable,
      }),
    ).rejects.toMatchObject({ category: 'config', code: 'MANIFEST_INVALID' });
    expect(fs.writes).toEqual([]);
  });
});

function editor(fs: FakeFs): SetRepoField {
  return new SetRepoField({
    async read(at) {
      const text = await fs.readText(path.join(at.root, at.relative));
      return { kind: text === undefined ? 'absent' : 'file', text: text ?? null };
    },
    async write(input) {
      const file = path.join(input.root, input.relative);
      if ((await fs.readText(file)) !== input.before.text) return 'conflict';
      if (input.text === input.before.text) return 'unchanged';
      await fs.writeText(file, input.text!);
      return 'written';
    },
  });
}
