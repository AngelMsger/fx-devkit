// The toolchain story end to end: a script on a private PATH stands in for
// a companion tool, a temporary FX_HOME holds trust and config, and every
// Skill copy lands in a temporary --dir rather than a real agent's directory.

import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readlinkSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { pathKey } from '../../src/domain/path.js';
import { writeNodeShim } from '../platform.js';

import { freshHome, fx, manifestDirOf, repository, searchPath, tempDir } from './harness.js';

const pkg = JSON.parse(readFileSync(path.resolve('package.json'), 'utf8')) as { version: string };

interface Stage {
  readonly ws: string;
  readonly toolsFile: string;
  readonly env: { readonly FX_HOME: string; readonly PATH: string };
}

function stage(): Stage {
  const base = tempDir('fx-tool-e2e-');
  const shims = path.join(base, 'shims');
  mkdirSync(shims);
  writeNodeShim(shims, 'fake-tool', 'console.log("fake-tool v1.2.3 (fixture)");');

  const host = path.join(base, 'host', 'fx');
  mkdirSync(host, { recursive: true });
  repository(host, 'a', { 'README.md': 'Synthetic tool workspace' });

  const manifestDir = path.join(base, 'src', 'manifest');
  mkdirSync(manifestDir, { recursive: true });
  writeFileSync(
    path.join(manifestDir, 'workspace.yaml'),
    [
      'schema_version: 2',
      'providers:',
      `  code-host: { provider: local-git, vars: { host: ${path.dirname(host)}, user: alice } }`,
      'defaults: { upstream_project: fx, branch: main }',
      'projects:',
      '  fx: { label: Local, contact: "#local" }',
      'repos:',
      '  - { name: a, desc: First, tags: [one] }',
      '',
    ].join('\n'),
  );
  writeFileSync(
    path.join(manifestDir, 'tools.yaml'),
    [
      'schema_version: 3',
      'tools:',
      "  - { name: fake-tool, min_version: '1.0.0', install: [{ via: manual }], skill: { command: [] } }",
      '',
    ].join('\n'),
  );

  const ws = path.join(base, 'ws');
  const env = {
    FX_HOME: freshHome(),
    PATH: searchPath(shims),
  };
  const boot = fx(
    ['init', ws, '--from', path.dirname(manifestDir), '--yes', '--format', 'json'],
    env,
  );
  expect(boot.status, boot.stderr).toBe(0);
  return {
    ws,
    toolsFile: path.join(manifestDirOf(env.FX_HOME, 'ws'), 'manifest', 'tools.yaml'),
    env,
  };
}

interface ToolFinding {
  readonly group: string;
  readonly id: string;
  readonly level: string;
  readonly message: string;
  readonly fix?: string;
}
interface Items<T> {
  readonly items: readonly T[];
}

describe('doctor checks a tool with trust-on-first-use', () => {
  it('keeps trusting the initial vector, then asks once when its arguments change', () => {
    const s = stage();
    const check = (expectedExit = 0, ...extra: string[]) => {
      const run = fx(
        ['doctor', '--details', '--tool', 'fake-tool', '--format', 'json', ...extra],
        s.env,
        s.ws,
      );
      expect(run.status, run.stderr).toBe(expectedExit);
      return (run.json() as { findings: ToolFinding[] }).findings.find(
        (f) => f.group === 'tools' && f.id === 'fake-tool',
      );
    };

    expect(check()).toMatchObject({ level: 'ok', message: '1.2.3 installed' });

    writeFileSync(
      s.toolsFile,
      [
        'schema_version: 3',
        'tools:',
        "  - { name: fake-tool, min_version: '1.0.0', version_args: [--version, --short], install: [{ via: manual }] }",
        '',
      ].join('\n'),
    );
    const untrusted = check(12);
    expect(untrusted).toMatchObject({
      level: 'warn',
      fix: 'fx doctor --tool fake-tool --workspace ws',
      handoff: { command: 'fx doctor --tool fake-tool --workspace ws' },
    });
    expect(untrusted?.message).toContain('trust');

    const before = readFileSync(path.join(s.env['FX_HOME'], 'trust.yaml'), 'utf8');
    const locked = fx(
      ['doctor', '--tool', 'fake-tool', '--yes', '--format', 'json'],
      { ...s.env, FX_READ_ONLY: '1' },
      s.ws,
    );
    const lockedFinding = (locked.json() as { findings: ToolFinding[] }).findings.find(
      (f) => f.group === 'tools' && f.id === 'fake-tool',
    );
    expect(lockedFinding).toMatchObject({
      level: 'warn',
      fix: 'fx doctor --tool fake-tool --allow-writes --workspace ws',
      handoff: { command: 'fx doctor --tool fake-tool --allow-writes --workspace ws' },
    });
    expect(readFileSync(path.join(s.env['FX_HOME'], 'trust.yaml'), 'utf8')).toBe(before);

    expect(check(0, '--yes')).toMatchObject({ level: 'ok' });
    const trustFile = readFileSync(path.join(s.env['FX_HOME'], 'trust.yaml'), 'utf8');
    expect(trustFile).toContain('ws:');
    expect(trustFile).toMatch(/[0-9a-f]{64}/);

    expect(check()).toMatchObject({ level: 'ok' });
  });
});

describe('tool show', () => {
  it('shows one tool with the origin of each field, and names the nearest tool for a typo', () => {
    const s = stage();
    const shown = fx(['tool', 'show', 'fake-tool', '--format', 'json'], s.env, s.ws);
    expect(shown.status, shown.stderr).toBe(0);
    expect(shown.json()).toMatchObject({
      name: 'fake-tool',
      binary: 'fake-tool',
      min_version: '1.0.0',
      enabled: true,
      version_args: ['--version'],
      install: [{ via: 'manual', spec: null, registry: null }],
      // The workspace declares this tool, so every field it carries came from the patch.
      fields: { name: 'patch', min_version: 'patch', install: 'patch' },
      depended_on_by: [],
    });
    expect(fx(['tool', 'show', 'fake-tool'], s.env, s.ws).stdout).toContain('fake-tool');

    const typo = fx(['tool', 'show', 'fake-tol', '--format', 'json'], s.env, s.ws);
    expect(typo.status).toBe(6);
    expect(typo.error()).toMatchObject({
      code: 'TOOL_UNKNOWN',
      hint: 'Did you mean "fake-tool"?',
    });

    const bare = fx(['tool', 'show', '--format', 'json'], s.env, s.ws);
    expect(bare.status).toBe(2);
  });
});

describe('agent list', () => {
  it('knows the whole family and where each keeps its Skills', () => {
    const s = stage();
    const list = fx(['agent', 'list', '--format', 'json'], s.env, s.ws);
    expect(list.status, list.stderr).toBe(0);
    const items = (list.json() as Items<{ id: string; skills_dir: string }>).items;
    expect(items.map((i) => i.id)).toContain('claude-code');
    for (const item of items) expect(path.isAbsolute(item.skills_dir)).toBe(true);
  });
});

describe('the skills stage of sync: the team link at the root, the fx copy in the agent', () => {
  it('preserves a companion failure in sync data even though the command reports partial success', () => {
    const s = stage();
    writeFileSync(path.join(s.env.FX_HOME, 'config.yaml'), 'agents: [claude-code]\n', {
      flag: 'a',
    });
    const failure = {
      category: 'permission',
      code: 'EXAMPLE_DENIED',
      message: 'fixture installation denied',
      hint: 'Check the fixture permission.',
      next_steps: ['fake-tool skill status'],
      retryable: false,
    };
    writeNodeShim(
      s.env.PATH.split(path.delimiter)[0]!,
      'fake-tool',
      `if (process.argv.includes('--version')) { console.log('1.2.3'); } else { console.error(JSON.stringify({error: ${JSON.stringify(failure)}})); process.exitCode = 5; }`,
    );
    writeFileSync(
      s.toolsFile,
      'schema_version: 3\ntools:\n  - name: fake-tool\n    install: [{via: manual}]\n    skill: {command: [skill, install]}\n',
    );
    const result = fx(
      ['sync', '--details', '--only', 'skills', '--yes', '--format', 'json'],
      s.env,
      s.ws,
    );
    expect(result.status, result.stderr).toBe(0);
    const output = result.json() as {
      stages: { skills: { tools_failed: number } };
      stage_details: { skills: { tools: { tool: string; code: number; failure?: unknown }[] } };
    };
    expect(output.stages.skills.tools_failed).toBeGreaterThan(0);
    expect(output.stage_details.skills.tools.find((row) => row.tool === 'fake-tool')).toMatchObject(
      {
        code: 5,
        failure,
      },
    );
    expect(result.stderr).toContain('SKILL_INSTALL_FAILED');
    expect(result.stdout).not.toContain('_notice');
  });

  it('links the team Skills directory it owns, prunes it when the source goes, and never touches a foreign one', () => {
    const s = stage();
    writeFileSync(path.join(s.env.FX_HOME, 'config.yaml'), 'agents: [claude-code]\n', {
      flag: 'a',
    });
    const skills = path.join(manifestDirOf(s.env.FX_HOME, 'ws'), 'skills');
    mkdirSync(path.join(skills, 'review'), { recursive: true });
    writeFileSync(path.join(skills, 'review', 'SKILL.md'), '---\nname: review\n---\n');
    const link = path.join(s.ws, '.claude', 'skills');
    const home = tempDir('fx-skill-home-');
    const copy = path.join(home, '.claude', 'skills', 'fx-workspace');
    const sync = () =>
      fx(
        ['sync', '--details', '--only', 'skills', '--format', 'json'],
        s.env,
        s.ws,
        undefined,
        home,
      );
    const summary = (run: ReturnType<typeof fx>) =>
      (run.json() as { stages: { skills: Record<string, number> } }).stages.skills;

    const created = sync();
    expect(created.status, created.stderr).toBe(0);
    const first = summary(created);
    expect(first).toMatchObject({ create: 1, install: 1 });
    expect(pathKey(readlinkSync(link))).toBe(pathKey(skills));
    expect(readFileSync(path.join(copy, 'SKILL.md'), 'utf8')).toContain(`version: ${pkg.version}`);
    expect(existsSync(path.join(copy, 'references', 'commands.md'))).toBe(true);

    expect(summary(sync())).toMatchObject({ unchanged: 1, current: 1, create: 0, install: 0 });

    const handmade = path.join(s.ws, '.claude', 'skills-mine');
    mkdirSync(handmade, { recursive: true });
    rmSync(link);
    mkdirSync(link);
    writeFileSync(path.join(link, 'SKILL.md'), 'mine\n');
    const foreign = sync();
    expect(foreign.error().code).toBe('INPUT_REQUIRED');
    expect(lstatSync(link).isDirectory()).toBe(true);
    expect(readFileSync(path.join(link, 'SKILL.md'), 'utf8')).toBe('mine\n');
    rmSync(link, { recursive: true });

    expect(summary(sync())).toMatchObject({ create: 1 });
    rmSync(skills, { recursive: true });
    expect(summary(sync())).toMatchObject({ prune: 1 });
    expect(existsSync(link)).toBe(false);
  });
});

it('uses the same collection selection for repeated and comma-separated flags', () => {
  const s = stage();
  const options = ['--dry-run', '--no-refresh-manifest', '--format', 'json'];
  const repeated = fx(
    ['sync', '--details', '--only', 'docs', '--only', 'skills', ...options],
    s.env,
    s.ws,
  );
  const comma = fx(['sync', '--details', '--only', 'docs,skills', ...options], s.env, s.ws);
  expect(repeated.status, repeated.stderr).toBe(0);
  expect(comma.status, comma.stderr).toBe(0);
  expect(repeated.json()).toEqual(comma.json());
  const canonical = fx(
    ['agent', 'skills', '--agent', 'codex,claude-code', '--format', 'json'],
    s.env,
    s.ws,
  );
  const compatible = fx(
    ['skill', 'list', '--agent', 'codex', '--agent', 'claude-code', '--format', 'json'],
    s.env,
    s.ws,
  );
  expect(canonical.status, canonical.stderr).toBe(0);
  expect(compatible.status, compatible.stderr).toBe(0);
  expect(canonical.json()).toEqual(compatible.json());
});
