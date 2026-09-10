// The toolchain story end to end: a script on a private PATH stands in for
// a companion tool, a temporary FX_HOME holds trust and config, and every
// Skill copy lands in a temporary --dir rather than a real agent's directory.

import { execFileSync } from 'node:child_process';
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readlinkSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { pathKey } from '../../src/domain/path.js';
import { writeNodeShim } from '../platform.js';

import { freshHome, fx, manifestDirOf, userHome } from './harness.js';

const pkg = JSON.parse(readFileSync(path.resolve('package.json'), 'utf8')) as { version: string };

interface Stage {
  readonly ws: string;
  readonly toolsFile: string;
  readonly env: { readonly FX_HOME: string; readonly PATH: string };
}

function stage(): Stage {
  const base = mkdtempSync(path.join(tmpdir(), 'fx-tool-e2e-'));
  const shims = path.join(base, 'shims');
  mkdirSync(shims);
  writeNodeShim(shims, 'fake-tool', 'console.log("fake-tool v1.2.3 (fixture)");');

  const host = path.join(base, 'host', 'fx');
  const bare = path.join(host, 'a.git');
  mkdirSync(host, { recursive: true });
  execFileSync('git', ['init', '--quiet', '--bare', '-b', 'main', bare]);

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
      'schema_version: 2',
      'tools:',
      "  - { name: fake-tool, min_version: '1.0.0', install: [{ via: manual }], skill: { command: [] } }",
      '',
    ].join('\n'),
  );

  const ws = path.join(base, 'ws');
  const env = {
    FX_HOME: freshHome(),
    PATH: `${shims}${path.delimiter}${process.env['PATH'] ?? ''}`,
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
    const check = (...extra: string[]) => {
      const run = fx(['doctor', '--tool', 'fake-tool', '--format', 'json', ...extra], s.env, s.ws);
      expect(run.status, run.stderr).toBe(0);
      return (run.json() as { findings: ToolFinding[] }).findings.find(
        (f) => f.group === 'tools' && f.id === 'fake-tool',
      );
    };

    expect(check()).toMatchObject({ level: 'ok', message: '1.2.3 installed' });

    writeFileSync(
      s.toolsFile,
      [
        'schema_version: 2',
        'tools:',
        "  - { name: fake-tool, min_version: '1.0.0', version_args: [--version, --short], install: [{ via: manual }] }",
        '',
      ].join('\n'),
    );
    const untrusted = check();
    expect(untrusted).toMatchObject({
      level: 'warn',
      fix: 'fx doctor --tool fake-tool',
      handoff: { command: 'fx doctor --tool fake-tool' },
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
      fix: 'fx doctor --tool fake-tool --allow-writes',
      handoff: { command: 'fx doctor --tool fake-tool --allow-writes' },
    });
    expect(readFileSync(path.join(s.env['FX_HOME'], 'trust.yaml'), 'utf8')).toBe(before);

    expect(check('--yes')).toMatchObject({ level: 'ok' });
    const trustFile = readFileSync(path.join(s.env['FX_HOME'], 'trust.yaml'), 'utf8');
    expect(trustFile).toContain('ws:');
    expect(trustFile).toMatch(/[0-9a-f]{64}/);

    expect(check()).toMatchObject({ level: 'ok' });
  });
});

describe('agent list', () => {
  it('knows the whole family and where each keeps its Skills', () => {
    const s = stage();
    const list = fx(['agent', 'list', '--format', 'json'], s.env, s.ws);
    expect(list.status, list.stderr).toBe(0);
    const items = (list.json() as Items<{ id: string; skills_dir: string }>).items;
    expect(items).toHaveLength(13);
    expect(items.map((i) => i.id)).toContain('claude-code');
    for (const item of items) expect(path.isAbsolute(item.skills_dir)).toBe(true);
  });
});

describe('the skills stage of sync: the team link at the root, the fx copy in the agent', () => {
  it('preserves a companion failure in sync data even though the command reports partial success', () => {
    const s = stage();
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
      'schema_version: 2\ntools:\n  - name: fake-tool\n    install: [{via: manual}]\n    skill: {command: [skill, install]}\n',
    );
    const result = fx(['sync', '--only', 'skills', '--yes', '--format', 'json'], s.env, s.ws);
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
    const copy = path.join(userHome, '.claude', 'skills', 'fx-workspace');
    const sync = () => fx(['sync', '--only', 'skills', '--format', 'json'], s.env, s.ws);
    const summary = (run: ReturnType<typeof fx>) =>
      (run.json() as { stages: { skills: Record<string, number> } }).stages.skills;

    const created = sync();
    expect(created.status, created.stderr).toBe(0);
    const first = summary(created);
    expect(first).toMatchObject({ create: 1 });
    // The user home is shared by the whole e2e run: an earlier sync may have installed the copy.
    expect((first['install'] ?? 0) + (first['current'] ?? 0)).toBe(1);
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
