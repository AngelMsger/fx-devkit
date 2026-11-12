// Execute the printed recovery from an unrelated directory and competing workspace context.

import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';
import { stringify } from 'yaml';

import { shellLine } from '../../src/domain/shell.js';
import { writeNodeShim } from '../platform.js';

import {
  childEnvironment,
  freshHome,
  fx,
  git,
  manifestDirOf,
  repository,
  searchPath,
} from './harness.js';

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
    env: { FX_HOME: home },
  };
}
function follow(command: string, s: ReturnType<typeof stage>, environment: NodeJS.ProcessEnv = {}) {
  expect(command.startsWith('fx ')).toBe(true);
  const executable = shellLine([process.execPath, path.resolve('bin/fx.js')]);
  const result = spawnSync('/bin/sh', ['-c', `${executable}${command.slice(2)} --format json`], {
    cwd: s.base,
    encoding: 'utf8',
    env: childEnvironment({ ...s.env, ...environment }),
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
  it('requires separate exact-vector trust before executing a configured probe', () => {
    const s = stage();
    const marker = path.join(s.base, 'untrusted-probe.txt');
    const bin = path.join(s.base, 'bin');
    writeNodeShim(
      bin,
      'custom-jenkins',
      `
const args=process.argv.slice(2);
if(args.includes('--version')) console.log('9.0.0');
else if(args.includes('auth')) console.log(JSON.stringify({authenticated:true}));
else require('node:fs').writeFileSync(process.env.PROBE_RECORD, 'executed');
`,
    );
    writeFileSync(
      path.join(manifestDirOf(s.home, 'alpha'), 'manifest/tools.yaml'),
      stringify({
        schema_version: 3,
        tools: [{ name: 'jenkins-cli', binary: 'custom-jenkins' }],
      }),
    );
    const env = { ...s.env, PATH: searchPath(bin), PROBE_RECORD: marker };
    const scope = ['--workspace', 'alpha', '--env', 'test', '--format', 'json'];
    expect(fx(['can', 'ci', ...scope, '--yes'], env, s.roots.beta).status).toBe(0);
    for (const check of [[], ['--no-check']]) {
      const blocked = fx(
        ['where', 'api', '--platform', 'ci', '--probe', '--no-input', ...scope, ...check],
        env,
        s.roots.beta,
      );
      expect(blocked.error().code).toBe('VECTOR_UNTRUSTED');
      expect(existsSync(marker)).toBe(false);
    }
    const allowed = fx(
      ['where', 'api', '--platform', 'ci', '--probe', '--yes', ...scope],
      env,
      s.roots.beta,
    );
    expect(allowed.status, allowed.stderr).toBe(0);
    expect(readFileSync(marker, 'utf8')).toBe('executed');
  });

  it('keeps nested service version checks on the selected workspace', () => {
    const s = stage();
    for (const name of ['alpha', 'beta'] as const)
      writeNodeShim(
        path.join(s.roots[name], 'bin'),
        'jenkins-cli',
        `
const args=process.argv.slice(2);
if(args.includes('--version')) console.log(${JSON.stringify(name === 'alpha' ? '9.0.0' : '0.1.0')});
else if(args.includes('config')||args.includes('reuse')) console.log(JSON.stringify({changed:false}));
else console.log(JSON.stringify({authenticated:true}));
`,
      );
    writeFileSync(
      path.join(manifestDirOf(s.home, 'alpha'), 'manifest/environments.yaml'),
      stringify({
        schema_version: 2,
        platforms: {
          ci: {
            provider: 'jenkins-cli',
            capability: 'ci',
            service: { base_url: 'https://ci.example.com', context: 'test', auth_scheme: 'token' },
          },
        },
        envs: { test: { platforms: { ci: { vars: { path: 'services/api/main' } } } } },
      }),
    );
    const result = fx(
      ['can', 'ci', '--workspace', 'alpha', '--env', 'test', '--format', 'json'],
      { ...s.env, PATH: `./bin${path.delimiter}${searchPath()}` },
      s.roots.beta,
    );
    expect(result.status, result.stderr).toBe(0);
    expect(result.json()).toMatchObject({
      status: 'ready',
      handoff: null,
      execution: { tool: 'jenkins-cli', version: '9.0.0', cwd: s.roots.alpha },
    });
  });

  it('keeps member selector recovery on the explicitly selected workspace', () => {
    const s = stage('beta');
    for (const [workspace, person] of [
      ['alpha', 'alice'],
      ['beta', 'bob'],
    ]) {
      writeFileSync(
        path.join(manifestDirOf(s.home, workspace!), 'manifest/members.yaml'),
        stringify({
          schema_version: 1,
          sensitive: true,
          people: [{ id: person }],
          areas: [
            {
              group: 'Ecosystem',
              scenarios: [{ name: 'Help Center', roles: { backend: [person] } }],
            },
          ],
        }),
      );
    }
    const env = { ...s.env, FX_WORKSPACE: 'beta' };
    const answer = fx(
      ['member', 'list', '--workspace', 'alpha', '--area', 'Help Center', '--format', 'json'],
      env,
      s.roots.beta,
    );
    expect(answer.error().code).toBe('AREA_NOT_FOUND');
    const command = answer.error().next_steps[0]!;
    expect(command).toContain('--workspace alpha');
    const recovered = follow(command, s, env);
    expect(recovered.status, recovered.stderr).toBe(0);
    expect(recovered.json()).toMatchObject({ items: [{ id: 'alice' }] });
  });

  it('checks, prints and probes the same configured binary from the selected workspace', () => {
    const s = stage();
    const marker = path.join(s.base, 'probe.txt');
    for (const name of ['alpha', 'beta'] as const) {
      writeNodeShim(
        path.join(s.roots[name], 'bin'),
        'custom-jenkins',
        `
const args = process.argv.slice(2);
if (args.includes('--version')) console.log('9.0.0');
else if (args.includes('auth')) console.log(JSON.stringify({authenticated:true}));
else require('node:fs').appendFileSync(process.env.PROBE_RECORD, ${JSON.stringify(name)} + '|' + process.cwd() + String.fromCharCode(10));
`,
      );
    }
    writeFileSync(
      path.join(manifestDirOf(s.home, 'alpha'), 'manifest/tools.yaml'),
      stringify({ schema_version: 3, tools: [{ name: 'jenkins-cli', binary: 'custom-jenkins' }] }),
    );
    const env = { ...s.env, PATH: `./bin${path.delimiter}${searchPath()}`, PROBE_RECORD: marker };
    const result = fx(
      [
        'where',
        'api',
        '--workspace',
        'alpha',
        '--env',
        'test',
        '--platform',
        'ci',
        '--probe',
        '--yes',
        '--format',
        'json',
      ],
      env,
      s.roots.beta,
    );
    expect(result.status, result.stderr).toBe(0);
    const row = (result.json() as { items: { command: string; probed: string }[] }).items[0]!;
    expect(row).toMatchObject({
      ready: 'ready',
      outcome: 'reachable',
      suggested_confidence: 'verified',
      execution: { tool: 'jenkins-cli', binary: 'custom-jenkins', cwd: s.roots.alpha },
    });
    expect(row.command).toContain('custom-jenkins');
    expect(row.probed).toContain('custom-jenkins');
    expect(readFileSync(marker, 'utf8')).toBe(`alpha|${s.roots.alpha}\n`);
  });

  it('does not let an unrelated incomplete setup block a scoped doctor repair', () => {
    const s = stage();
    writeFileSync(
      path.join(manifestDirOf(s.home, 'alpha'), 'manifest/environments.yaml'),
      stringify({
        schema_version: 2,
        platforms: {
          ci: { provider: 'jenkins-cli', capability: 'ci' },
          cluster: { provider: 'kubectl', capability: 'cluster' },
        },
        envs: { test: { platforms: { ci: { vars: { path: 'services/api/main' } }, cluster: {} } } },
      }),
    );
    const bin = path.join(s.base, 'bin');
    writeNodeShim(
      bin,
      'jenkins-cli',
      "if (process.argv.includes('--version')) console.log('9.0.0'); else console.log(JSON.stringify({authenticated:true}));",
    );
    const result = fx(
      [
        'doctor',
        '--tool',
        'jenkins-cli',
        '--workspace',
        'alpha',
        '--fix',
        '--yes',
        '--format',
        'json',
        '--details',
      ],
      { ...s.env, PATH: searchPath(bin) },
      s.roots.beta,
    );
    expect(result.status, result.stderr).toBe(0);
    const report = result.json() as { findings: { id: string }[] };
    expect(report).toMatchObject({
      repairs: [{ group: 'login', status: 'completed' }],
      coverage: 'complete',
    });
    expect(report.findings.some((finding) => finding.id.startsWith('kubectl'))).toBe(false);
  });

  it('executes the checked companion after a later shell selects an older installation', () => {
    const s = stage();
    const current = path.join(s.base, 'current tools');
    const old = path.join(s.base, 'old tools');
    const checked = writeNodeShim(
      current,
      'jenkins-cli',
      `
const args = process.argv.slice(2);
if (args.includes('--version')) console.log('9.0.0');
else if (args.includes('auth')) console.log(JSON.stringify({authenticated:true}));
else console.log('checked installation');
`,
    );
    writeNodeShim(old, 'jenkins-cli', "console.log('old installation');");
    const result = fx(
      ['where', 'api', '--env', 'test', '--platform', 'ci', '--format', 'json'],
      { ...s.env, PATH: searchPath(current) },
      s.roots.alpha,
    );
    expect(result.status, result.stderr).toBe(0);
    const row = (
      result.json() as {
        items: {
          ready: string;
          command: string;
          execution: { binary_path: string; version: string; cwd: string };
        }[];
      }
    ).items[0]!;
    expect(row).toMatchObject({
      ready: 'ready',
      execution: { binary_path: checked, version: '9.0.0', cwd: s.roots.alpha },
    });
    const env = childEnvironment({ ...s.env, PATH: searchPath(old) });
    expect(
      spawnSync('/bin/sh', ['-c', 'jenkins-cli --version'], {
        env,
        encoding: 'utf8',
      }).stdout.trim(),
    ).toBe('old installation');
    const follow = spawnSync('/bin/sh', ['-c', row.command], {
      cwd: row.execution.cwd,
      env,
      encoding: 'utf8',
    });
    expect(follow.status, follow.stderr).toBe(0);
    expect(follow.stdout.trim()).toBe('checked installation');
  });

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
    writeNodeShim(
      shims,
      'fixture-tool',
      "if (process.argv.includes('--version')) console.log('1.0.0'); else process.exit(1);",
    );
    const env = {
      ...s.env,
      FX_WORKSPACE: 'beta',
      PATH: searchPath(shims),
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
      [
        'doctor',
        '--tool',
        'fixture-tool',
        '--workspace',
        'alpha',
        '--yes',
        '--format',
        'json',
        '--details',
      ],
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
