// Execute the printed recovery from an unrelated directory and competing workspace context.

import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';
import { stringify } from 'yaml';

import { shellLine } from '../../src/domain/shell.js';
import { writeNodeShim } from '../platform.js';

import { freshHome, fx, git, manifestDirOf, repository, userHome } from './harness.js';

const invalid = 'schema_version: 2\nrepos: invalid\n';
function manifest(name: string): string {
  return stringify({
    schema_version: 2,
    defaults: { branch: 'main' },
    repos: [{ name, upstream: `https://git.example.com/team/${name}.git` }],
  });
}
function stage(defaultWorkspace?: string) {
  const home = realpathSync(freshHome());
  const base = realpathSync(freshHome());
  const roots = { alpha: path.join(base, "alpha's workspace"), beta: path.join(base, 'beta') };
  const sources = { alpha: path.join(base, 'alpha-source'), beta: path.join(base, 'beta-source') };
  for (const name of ['alpha', 'beta'] as const) {
    mkdirSync(roots[name]);
    const dir = manifestDirOf(home, name);
    mkdirSync(path.join(dir, 'manifest'), { recursive: true });
    writeFileSync(
      path.join(dir, 'manifest/workspace.yaml'),
      manifest(name === 'alpha' ? 'api' : 'other'),
    );
    writeFileSync(
      path.join(dir, 'manifest/environments.yaml'),
      stringify({
        schema_version: 2,
        platforms: { ci: { provider: 'jenkins-cli', capability: 'ci' } },
        envs: {
          [name === 'alpha' ? 'test' : 'production']: {
            platforms: { ci: { vars: { path: 'services/api/main' } } },
          },
        },
      }),
    );
  }
  const config = {
    ...(defaultWorkspace === undefined ? {} : { default_workspace: defaultWorkspace }),
    agents: [],
    hooks: false,
    workspaces: {
      alpha: { root: roots.alpha, source: sources.alpha },
      beta: { root: roots.beta, source: sources.beta },
    },
  };
  writeFileSync(path.join(home, 'config.yaml'), stringify(config));
  return {
    home,
    base,
    roots,
    sources,
    config,
    env: {
      FX_HOME: home,
      FX_AGENTS: '',
      FX_HOOKS: '0',
      FX_UPDATE_CHECK: '0',
      FX_COMMAND_SHELL: 'posix',
    },
  };
}
function follow(command: string, s: ReturnType<typeof stage>, environment: NodeJS.ProcessEnv = {}) {
  expect(command.startsWith('fx ')).toBe(true);
  const executable = shellLine([process.execPath, path.resolve('bin/fx.js')]);
  const result = spawnSync('/bin/sh', ['-c', `${executable}${command.slice(2)} --format json`], {
    cwd: s.base,
    encoding: 'utf8',
    env: { ...process.env, ...s.env, ...environment, HOME: userHome, USERPROFILE: userHome },
  });
  return {
    ...result,
    json: () => JSON.parse(result.stdout),
    error: () =>
      JSON.parse(result.stderr.trim().split('\n').at(-1)!).error as {
        code: string;
        message: string;
        hint: string;
        next_steps: string[];
      },
  };
}

describe.skipIf(process.platform === 'win32')('scoped recovery commands in a POSIX shell', () => {
  it.each(['none', 'beta', 'environment'] as const)(
    'keeps repo/env recovery on alpha with context %s',
    (context) => {
      const s = stage(context === 'beta' ? 'beta' : undefined);
      const override = context === 'environment' ? { FX_WORKSPACE: 'beta' } : {};
      const env = { ...s.env, ...override };
      const cases = [
        {
          args: ['repo', 'select', 'apii'],
          command: 'fx repo list --workspace alpha',
          item: 'api',
        },
        { args: ['repo', 'show', 'apii'], command: 'fx repo list --workspace alpha', item: 'api' },
        { args: ['env', 'select', 'tset'], command: 'fx env list --workspace alpha', item: 'test' },
        { args: ['env', 'show', 'tset'], command: 'fx env list --workspace alpha', item: 'test' },
        {
          args: ['where', 'api', '--env', 'tset', '--no-check'],
          command: 'fx env list --workspace alpha',
          item: 'test',
        },
        {
          args: ['where', 'api', '--env', 'test', '--platform', 'missing', '--no-check'],
          command: 'fx env show test --workspace alpha',
          item: 'test',
        },
      ];
      for (const entry of cases) {
        const result = fx([...entry.args, '--workspace', 'alpha', '--format', 'json'], env, s.base);
        expect(result.status).not.toBe(0);
        expect(result.error().next_steps, result.stderr).toContain(entry.command);
        const recovered = follow(entry.command, s, override);
        expect(recovered.status, recovered.stderr).toBe(0);
        const json = recovered.json();
        expect(json.items?.map((item: { name: string }) => item.name) ?? [json.name]).toContain(
          entry.item,
        );
      }
    },
  );

  it.each([undefined, 'beta'])(
    'revalidates a quoted invalid candidate instead of default %s',
    (defaultWorkspace) => {
      const s = stage(defaultWorkspace);
      const candidate = path.join(s.base, "candidate's invalid manifest");
      mkdirSync(path.join(candidate, 'manifest'), { recursive: true });
      writeFileSync(path.join(candidate, 'manifest/workspace.yaml'), invalid);
      const expected = shellLine([
        'fx',
        'workspace',
        'rebind',
        'alpha',
        '--from',
        candidate,
        '--dry-run',
      ]);
      for (const mode of [[], ['--dry-run']]) {
        const result = fx(
          ['workspace', 'rebind', 'alpha', '--from', candidate, ...mode, '--format', 'json'],
          { ...s.env, FX_WORKSPACE: 'beta' },
          s.base,
        );
        expect(result.error()).toMatchObject({ code: 'MANIFEST_INVALID', next_steps: [expected] });
        expect(result.stderr).toContain(candidate);
        const recovered = follow(result.error().next_steps[0]!, s, { FX_WORKSPACE: 'beta' });
        expect(recovered.error()).toMatchObject({
          code: 'MANIFEST_INVALID',
          next_steps: [expected],
        });
        expect(recovered.error().message).toContain(candidate);
      }
      expect(
        fx(['workspace', 'show', 'alpha', '--format', 'json'], s.env, s.base).json(),
      ).toMatchObject({ source: s.sources.alpha, registration_status: 'available' });
    },
  );

  it('identifies committed candidate HEAD even when its local working file has been repaired', () => {
    const s = stage('beta');
    const candidate = repository(s.base, "candidate's source", {
      'manifest/workspace.yaml': invalid,
    });
    writeFileSync(path.join(candidate.author, 'manifest/workspace.yaml'), manifest('fixed'));
    const result = fx(
      ['workspace', 'rebind', 'alpha', '--from', candidate.author, '--dry-run', '--format', 'json'],
      s.env,
      s.base,
    );
    expect(result.error().code).toBe('MANIFEST_INVALID');
    expect(result.stderr).toContain(`${candidate.author}@HEAD`);
    expect(result.error().hint).toContain('Correct and commit');
    expect(follow(result.error().next_steps[0]!, s).error().code).toBe('MANIFEST_INVALID');
  });

  it('identifies a retained invalid managed worktree rather than the healthy source HEAD', () => {
    const s = stage('beta');
    const candidate = repository(s.base, 'healthy-source', {
      'manifest/workspace.yaml': manifest('api'),
    });
    const managed = manifestDirOf(s.home, 'alpha');
    rmSync(managed, { recursive: true });
    git(['clone', '--quiet', '--origin', 'upstream', candidate.author, managed], s.base);
    writeFileSync(path.join(managed, 'manifest/workspace.yaml'), invalid);
    writeFileSync(
      path.join(s.home, 'config.yaml'),
      stringify({
        ...s.config,
        workspaces: {
          ...s.config.workspaces,
          alpha: { root: s.roots.alpha, source: candidate.author },
        },
      }),
    );
    const result = fx(
      [
        'init',
        s.roots.alpha,
        '--name',
        'alpha',
        '--from',
        candidate.author,
        '--dry-run',
        '--format',
        'json',
      ],
      s.env,
      s.base,
    );
    expect(result.error().code).toBe('MANIFEST_INVALID');
    expect(result.error().hint).toContain(`retained managed worktree at ${managed}`);
    expect(
      follow(result.error().next_steps[0]!, s, { FX_WORKSPACE: 'beta' }).error().hint,
    ).toContain(managed);
    expect(readFileSync(path.join(managed, 'manifest/workspace.yaml'), 'utf8')).toBe(invalid);
  });
  it('keeps missing-environment and no-access fixes on alpha with another default and environment override', () => {
    const s = stage('beta');
    const env = { ...s.env, FX_WORKSPACE: 'beta', PATH: '' };
    writeFileSync(
      path.join(s.home, 'workspaces/alpha/local.yaml'),
      stringify({ scope: { envs: [] } }),
    );
    const betaLocal = path.join(s.home, 'workspaces/beta/local.yaml');
    const untouched = stringify({ scope: { envs: [] } });
    writeFileSync(betaLocal, untouched);
    const missing = fx(['can', 'ci', '--workspace', 'alpha', '--format', 'json'], env, s.base);
    expect(missing.error()).toMatchObject({
      code: 'ENV_REQUIRED',
      next_steps: ['fx env list --workspace alpha', "fx can ci --env '<env>' --workspace alpha"],
    });
    const recovered = follow(missing.error().next_steps[0]!, s, env);
    expect(recovered.status, recovered.stderr).toBe(0);
    expect(recovered.json().items.map((item: { name: string }) => item.name)).toEqual(['test']);
    const inaccessible = fx(
      ['can', 'ci', '--env', 'test', '--workspace', 'alpha', '--format', 'json'],
      env,
      s.base,
    ).json() as { status: string; alternatives: string[] };
    expect(inaccessible).toMatchObject({
      status: 'no_access',
      alternatives: ['fx env pick test --workspace alpha', 'fx doctor --workspace alpha'],
    });
    const picked = follow(inaccessible.alternatives[0]!, s, env);
    expect(picked.status, picked.stderr).toBe(0);
    expect(picked.json()).toMatchObject({ workspace: 'alpha', after: ['test'] });
    expect(readFileSync(betaLocal, 'utf8')).toBe(untouched);
  });

  it('keeps missing-tool installation and doctor fixes on the selected tool definitions', () => {
    const s = stage('beta');
    const env = { ...s.env, FX_WORKSPACE: 'beta', PATH: '' };
    for (const name of ['alpha', 'beta'])
      writeFileSync(
        path.join(manifestDirOf(s.home, name), 'manifest/tools.yaml'),
        stringify({
          schema_version: 3,
          tools: [
            {
              name: 'jenkins-cli',
              binary: 'fx-fixture-missing-jenkins',
              install: [{ via: 'manual' }],
              docs: `https://${name}.example.com/setup`,
            },
          ],
        }),
      );
    const verdict = fx(
      ['can', 'ci', '--env', 'test', '--workspace', 'alpha', '--format', 'json'],
      env,
      s.base,
    ).json() as { status: string; handoff: { command: string } };
    expect(verdict).toMatchObject({
      status: 'missing_tool',
      handoff: { command: 'fx tool install jenkins-cli --workspace alpha' },
    });
    const installed = follow(verdict.handoff.command, s, env);
    expect(installed.status, installed.stderr).toBe(0);
    expect(installed.json().items[0]).toMatchObject({
      name: 'jenkins-cli',
      via: 'manual',
      docs: 'https://alpha.example.com/setup',
      ran: false,
    });
    const report = fx(
      ['doctor', '--tool', 'jenkins-cli', '--workspace', 'alpha', '--format', 'json', '--details'],
      env,
      s.base,
    ).json() as { findings: { group: string; id: string; fix?: string }[] };
    expect(
      report.findings.find((item) => item.group === 'tools' && item.id === 'jenkins-cli')?.fix,
    ).toBe('fx tool install jenkins-cli --workspace alpha');
    for (const command of ['install', 'update']) {
      const unknown = fx(
        ['tool', command, 'jenknis-cli', '--workspace', 'alpha', '--dry-run', '--format', 'json'],
        env,
        s.base,
      );
      expect(unknown.error()).toMatchObject({
        code: 'TOOL_UNKNOWN',
        next_steps: ['fx tool list --catalog --workspace alpha'],
      });
      const listed = follow(unknown.error().next_steps[0]!, s, env);
      expect(listed.status, listed.stderr).toBe(0);
    }
  });

  it('preserves login/setup handoff scope without changing global inventory semantics', () => {
    const s = stage('beta');
    writeFileSync(
      path.join(manifestDirOf(s.home, 'alpha'), 'manifest/tools.yaml'),
      stringify({
        schema_version: 3,
        tools: [
          {
            name: 'fixture-tool',
            install: [{ via: 'manual' }],
            setup: [
              {
                id: 'access',
                kind: 'manual',
                title: 'Enable fixture access',
                verify: { command: ['auth', 'status'] },
              },
            ],
          },
        ],
      }),
    );
    // Installed, with its access not yet enabled: the step is a person's to finish.
    const shims = path.join(s.base, 'shims');
    writeNodeShim(shims, 'fixture-tool', 'process.exit(1);');
    const env = {
      ...s.env,
      FX_WORKSPACE: 'beta',
      PATH: `${shims}${path.delimiter}${process.env['PATH'] ?? ''}`,
    };
    const result = fx(
      ['login', 'fixture-tool', '--workspace', 'alpha', '--no-input', '--yes', '--format', 'json'],
      env,
      s.base,
    );
    expect(result.error(), result.stderr).toMatchObject({
      code: 'LOGIN_REQUIRED',
      next_steps: ['fx login fixture-tool --workspace alpha', 'fx doctor --workspace alpha'],
    });
    const pending = follow(result.error().next_steps[0]!, s, env);
    expect(pending.error().code).toBe('LOGIN_REQUIRED');
    const report = fx(
      ['doctor', '--tool', 'fixture-tool', '--workspace', 'alpha', '--format', 'json', '--details'],
      env,
      s.base,
    ).json() as { findings: { group: string; id: string; fix?: string }[] };
    expect(
      report.findings.find((item) => item.group === 'login' && item.id === 'fixture-tool.access')
        ?.fix,
    ).toBe('fx login fixture-tool --workspace alpha');
    expect(fx(['tool', 'inventory', '--format', 'json'], env, s.base).status).toBe(0);
  });
});
