// The end-of-command update notices: a workspace hears that its manifest
// repository moved upstream, on any command, without the command's own
// result changing; sync settles it; the switches silence it.

import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { writeNodeShim } from '../platform.js';

import {
  freshHome,
  fx,
  git,
  manifestDirOf,
  repository,
  searchPath,
  tempDir,
  type Repository,
} from './harness.js';

interface Stage {
  readonly manifest: Repository;
  readonly ws: string;
  readonly home: string;
  readonly env: { readonly FX_HOME: string; readonly FX_UPDATE_CHECK: string };
}

function stage(): Stage {
  const base = tempDir('fx-update-e2e-');
  const host = path.join(base, 'host');
  mkdirSync(path.join(host, 'fx'), { recursive: true });
  repository(path.join(host, 'fx'), 'a', { README: 'a\n' });
  const manifest = repository(base, 'fx-workspace', {
    'manifest/workspace.yaml': [
      'schema_version: 2',
      'providers:',
      `  code-host: { provider: local-git, vars: { host: ${host}, user: alice } }`,
      'defaults: { upstream_project: fx, branch: main }',
      'projects:',
      '  fx: { label: Local, contact: "#local" }',
      'repos:',
      '  - { name: a, desc: A, tags: [one] }',
      '',
    ].join('\n'),
  });
  const home = freshHome();
  return {
    manifest,
    ws: path.join(base, 'ws'),
    home,
    env: { FX_HOME: home, FX_UPDATE_CHECK: '1' },
  };
}

const codes = (stderr: string): string[] =>
  stderr
    .split('\n')
    .filter((line) => line.startsWith('{"_notice"'))
    .map((line) => (JSON.parse(line) as { _notice: { code: string } })._notice.code);

// The window is an hour; a test that moved upstream forgets the answer instead of waiting.
const forget = (home: string): void =>
  rmSync(path.join(home, 'cache'), { recursive: true, force: true });

const json = ['--format', 'json'] as const;

function initialized(): Stage {
  const s = stage();
  const boot = fx(['init', '--details', s.ws, '--from', s.manifest.bare, ...json], s.env);
  expect(boot.status, boot.stderr).toBe(0);
  return s;
}

describe('update notices', () => {
  it('report a manifest that moved upstream on any command, are settled by sync, and never change the result', () => {
    const s = initialized();

    const current = fx(['status', ...json], s.env, s.ws);
    expect(current.status).toBe(0);
    expect(codes(current.stderr)).not.toContain('MANIFEST_OUTDATED');

    s.manifest.commit({ 'README.md': 'moved\n' }, 'move');
    forget(s.home);
    const moved = fx(['status', ...json], s.env, s.ws);
    expect(moved.status).toBe(0);
    expect(moved.json()).toEqual(current.json());
    const notice = moved.stderr
      .split('\n')
      .map((line) =>
        line.startsWith('{"_notice"')
          ? (
              JSON.parse(line) as {
                _notice: { code: string; nextSteps: string[]; silence: string };
              }
            )._notice
          : undefined,
      )
      .find((n) => n?.code === 'MANIFEST_OUTDATED');
    expect(notice).toMatchObject({
      nextSteps: ['fx sync'],
      silence: expect.stringContaining('update_check'),
    });

    const failing = fx(['repo', 'show', 'nope', ...json], s.env, s.ws);
    expect(failing.status).toBe(6);
    expect(codes(failing.stderr)).toContain('MANIFEST_OUTDATED');

    expect(codes(fx(['status', '--quiet', ...json], s.env, s.ws).stderr)).toEqual([]);
    expect(
      codes(fx(['status', ...json], { ...s.env, FX_UPDATE_CHECK: '0' }, s.ws).stderr),
    ).not.toContain('MANIFEST_OUTDATED');

    expect(fx(['sync', '--details', ...json], s.env, s.ws).status).toBe(0);
    expect(codes(fx(['status', ...json], s.env, s.ws).stderr)).not.toContain('MANIFEST_OUTDATED');

    const source = manifestDirOf(s.home, 'ws');
    git(['checkout', '-q', '-b', 'skill-x'], source);
    s.manifest.commit({ 'skills/x/SKILL.md': '---\nname: x\ndescription: X\n---\n' }, 'skill');
    forget(s.home);
    expect(codes(fx(['status', ...json], s.env, s.ws).stderr)).toContain('MANIFEST_OUTDATED');
    const kept = fx(['sync', '--details', ...json], s.env, s.ws);
    expect(kept.status).toBe(0);
    expect(codes(kept.stderr)).toContain('MANIFEST_REFRESH_KEPT');
    expect(codes(kept.stderr)).not.toContain('MANIFEST_OUTDATED');
    expect(codes(fx(['status', ...json], s.env, s.ws).stderr)).not.toContain('MANIFEST_OUTDATED');
    forget(s.home);
    expect(codes(fx(['status', ...json], s.env, s.ws).stderr)).not.toContain('MANIFEST_OUTDATED');
  });

  it('show in doctor as a manifest behind its upstream, unless doctor is told to stay quiet', () => {
    const s = initialized();
    s.manifest.commit({ 'README.md': 'moved\n' }, 'move');

    const doctor = fx(['doctor', '--details', ...json], s.env, s.ws).json() as {
      findings: { group: string; id: string; level: string; fix?: string }[];
    };
    expect(doctor.findings.find((f) => f.id === 'upstream')).toMatchObject({
      group: 'manifest',
      level: 'warn',
      fix: 'fx sync --workspace ws',
    });
    expect(doctor.findings.find((f) => f.group === 'self')?.id).toBe('version');
    const off = fx(
      ['doctor', '--details', '--quiet', ...json],
      s.env,
      s.ws,
    ).json() as typeof doctor;
    expect(off.findings.find((f) => f.id === 'upstream')?.level).toBe('ok');
  });

  it('do not run for a command that failed before reading its configuration', () => {
    const home = freshHome();
    writeFileSync(path.join(home, 'config.yaml'), 'user: [not: a string\n');
    const run = fx(['self', 'info', '--format', 'json'], { FX_HOME: home, FX_UPDATE_CHECK: '1' });
    expect(run.status).toBe(3);
    expect(run.error().code).toBe('CONFIG_INVALID');
    expect(codes(run.stderr)).toEqual([]);
    expect(existsSync(path.join(home, 'cache'))).toBe(false);
  });
});

// The installer is a local shim: this never changes the installed fx package.
it('self update keeps installer output out of its JSON result', () => {
  const shims = tempDir('fx-update-shim-');
  writeNodeShim(
    shims,
    'npm',
    'console.log("installer progress"); console.error("installer diagnostic"); process.exit(17);',
  );
  const result = fx(['self', 'update', '--yes', '--no-input', '--format', 'json'], {
    FX_HOME: freshHome(),
    FX_REGISTRY: 'https://npm.example.com',
    PATH: searchPath(shims),
  });
  expect(result.json()).toMatchObject({ ran: true, code: 17 });
  expect(result.stdout).not.toContain('installer progress');
});

// A successful installer shim leaves this fx in place, so the refresh that follows is this
// build's own `skill update`, running as a separate invocation that resolves its posture again.
it('self update carries an explicit --allow-writes into its Skill refresh', () => {
  const shims = tempDir('fx-update-shim-');
  writeNodeShim(shims, 'npm', 'process.exit(0);');
  const userHome = tempDir('fx-update-user-');
  const skill = path.join(userHome, '.claude', 'skills', 'fx-workspace', 'SKILL.md');
  mkdirSync(path.dirname(skill), { recursive: true });
  writeFileSync(skill, '---\nname: fx-workspace\nversion: 0.0.1\n---\nold');
  const result = fx(
    ['self', 'update', '--yes', '--no-input', '--allow-writes', '--format', 'json'],
    {
      FX_HOME: freshHome(),
      FX_READ_ONLY: '1',
      FX_REGISTRY: 'https://npm.example.com',
      PATH: searchPath(shims),
    },
    undefined,
    undefined,
    userHome,
  );
  expect(result.status, result.stderr).toBe(0);
  expect(result.json()).toMatchObject({
    ran: true,
    code: 0,
    skill_refresh: { ran: true, code: 0, refreshed: 1 },
  });
  expect(readFileSync(skill, 'utf8')).not.toContain('version: 0.0.1');
});
