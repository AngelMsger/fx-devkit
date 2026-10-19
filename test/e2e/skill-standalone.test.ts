import { spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { childEnvironment, tempDir } from './harness.js';

const bin = path.resolve('bin/fx.js');
const bundled = path.resolve('skills/fx-workspace');
const version = JSON.parse(readFileSync('package.json', 'utf8')).version;

function stage() {
  const root = tempDir('fx-skill-standalone-');
  const home = path.join(root, 'home');
  mkdirSync(home);
  const run = (args: string[], extra: NodeJS.ProcessEnv = {}) => {
    const result = spawnSync(process.execPath, [bin, 'skill', ...args, '--format', 'json'], {
      cwd: root,
      encoding: 'utf8',
      timeout: 5000,
      env: childEnvironment(
        { FX_HOME: path.join(root, 'fx'), FX_UPDATE_CHECK: '1', ...extra },
        home,
      ),
    });
    return {
      ...result,
      json: () => JSON.parse(result.stdout),
      error: () => JSON.parse(result.stderr.trim().split('\n').at(-1)!).error,
    };
  };
  return { root, home, run };
}

function installed(base: string, installedVersion = version) {
  const target = path.join(base, 'fx-workspace');
  mkdirSync(target, { recursive: true });
  writeFileSync(
    path.join(target, 'SKILL.md'),
    `---\nname: fx-workspace\nversion: ${installedVersion}\n---\nold`,
  );
  return target;
}

describe('standalone companion Skill lifecycle', () => {
  it('installs, refreshes and removes a complete copy without a workspace or network notices', () => {
    const s = stage();
    const target = path.join(s.root, 'custom', 'fx-workspace');
    const first = s.run(['install', '--dir', './custom']);
    expect(first.status, first.stderr).toBe(0);
    expect(first.stderr).toBe('');
    expect(first.json()).toMatchObject({
      items: [{ status: 'installed', version }],
      has_more: false,
    });
    expect(readFileSync(path.join(target, 'references/commands.md'), 'utf8')).toBe(
      readFileSync(path.join(bundled, 'references/commands.md'), 'utf8'),
    );
    writeFileSync(path.join(target, 'obsolete.md'), 'old file');
    expect(s.run(['install', '--dir', './custom']).status).toBe(0);
    expect(existsSync(path.join(target, 'obsolete.md'))).toBe(false);
    installed(path.dirname(target), '99.0.0');
    expect(s.run(['status', '--dir', './custom'], { FX_SKILL_LOADED: '1' }).json()).toMatchObject({
      activation: 'unverified',
      installs: [{ version_state: 'newer' }],
    });
    expect(s.run(['install', '--dir', './custom']).json().items[0].version).toBe(version);
    const blocked = s.run(['uninstall', '--dir', './custom']);
    expect(blocked.error().code).toBe('INPUT_REQUIRED');
    expect(existsSync(target)).toBe(true);
    expect(s.run(['uninstall', '--dir', './custom', '--yes']).json().items[0].status).toBe(
      'removed',
    );
    expect(s.run(['uninstall', '--dir', './custom', '--yes']).json().items[0].status).toBe(
      'not_installed',
    );
  });

  it('keeps previews and read-only calls free of Skill writes', () => {
    const s = stage();
    const preview = s.run(['install', '--dir', './custom', '--dry-run'], { FX_READ_ONLY: '1' });
    expect(preview.status, preview.stderr).toBe(0);
    expect(preview.json().items[0].status).toBe('planned');
    expect(existsSync(path.join(s.root, 'custom'))).toBe(false);
    expect(s.run(['install', '--dir', './custom'], { FX_READ_ONLY: '1' }).error().code).toBe(
      'READONLY_BLOCKED',
    );
    expect(
      s.run(['install', '--dir', './custom', '--allow-writes'], { FX_READ_ONLY: '1' }).status,
    ).toBe(0);
  });

  it('uses project markers and deduplicates native destinations', () => {
    const s = stage();
    writeFileSync(path.join(s.root, 'AGENTS.md'), '# Project');
    const result = s.run(['install', '--project']);
    expect(result.status, result.stderr).toBe(0);
    expect(result.json().items).toHaveLength(1);
    expect(result.json().items[0].agent).toContain('codex');
    expect(result.json().items[0].agent).toContain('agents');
    const explicit = s.run(['install', '--project', '--agent', 'codex,agents', '--agent', 'codex']);
    expect(explicit.json().items).toHaveLength(1);
    expect(s.run(['status', '--project', '--agent', 'codex']).json()).toMatchObject({
      activation: 'unverified',
      embedded_version: version,
      installs: [{ status: 'installed', version_state: 'matching' }],
    });
  });

  it('enumerates targets and keeps show output raw', () => {
    const s = stage();
    expect(s.run(['path']).json().items).toHaveLength(13);
    const shown = s.run(['show']);
    expect(shown.stdout).toBe(readFileSync(path.join(bundled, 'SKILL.md'), 'utf8'));
    expect(shown.stderr).toBe('');
    expect(s.run(['install', '--project']).error().code).toBe('SKILL_NO_AGENT');
    expect(s.run(['install', '--agent', 'unknown']).error().code).toBe('SKILL_AGENT');
    expect(s.run(['install', '--dir', './custom', '--agent', 'codex']).error().code).toBe(
      'SKILL_FLAGS',
    );
    expect(s.run(['install', '--dir', './custom', '--project']).error().code).toBe('SKILL_FLAGS');
  });

  it('installs explicit user targets independently of configured workspace agents', () => {
    const s = stage();
    const result = s.run(['install', '--agent', 'grok'], { FX_AGENTS: 'codex' });
    expect(result.status, result.stderr).toBe(0);
    expect(result.json().items[0]).toMatchObject({ agent: 'grok', status: 'installed' });
    expect(existsSync(path.join(s.home, '.grok/skills/fx-workspace/SKILL.md'))).toBe(true);
    expect(existsSync(path.join(s.home, '.codex/skills'))).toBe(false);
  });

  it('backs up foreign paths only after explicit replacement and never uninstalls them', () => {
    const s = stage();
    const target = path.join(s.root, 'custom', 'fx-workspace');
    mkdirSync(path.dirname(target));
    writeFileSync(target, 'personal');
    expect(s.run(['uninstall', '--dir', './custom', '--yes']).json().items[0].status).toBe(
      'foreign',
    );
    expect(s.run(['install', '--dir', './custom']).error().code).toBe('INPUT_REQUIRED');
    expect(readFileSync(target, 'utf8')).toBe('personal');
    const replaced = s.run(['install', '--dir', './custom', '--yes']);
    expect(replaced.status, replaced.stderr).toBe(0);
    expect(readFileSync(`${target}.fx-backup`, 'utf8')).toBe('personal');
  });

  it('protects shared manifest trees through direct and linked project paths', () => {
    const s = stage();
    const source = path.join(s.root, 'source');
    mkdirSync(path.join(source, 'manifest'), { recursive: true });
    mkdirSync(path.join(source, 'skills'));
    writeFileSync(path.join(source, 'manifest/workspace.yaml'), 'schema_version: 1');
    mkdirSync(path.join(s.root, '.agents'));
    symlinkSync(
      path.join(source, 'skills'),
      path.join(s.root, '.agents/skills'),
      process.platform === 'win32' ? 'junction' : 'dir',
    );
    expect(s.run(['install', '--project', '--agent', 'codex', '--yes']).error().code).toBe(
      'SKILL_SOURCE_PROTECTED',
    );
    expect(s.run(['install', '--dir', path.join(source, 'skills'), '--yes']).error().code).toBe(
      'SKILL_SOURCE_PROTECTED',
    );
    expect(s.run(['install', '--dir', path.dirname(bundled), '--yes']).error().code).toBe(
      'SKILL_SOURCE_PROTECTED',
    );
    expect(existsSync(path.join(source, 'skills/fx-workspace'))).toBe(false);
    expect(realpathSync(path.join(s.root, '.agents/skills'))).toBe(
      realpathSync(path.join(source, 'skills')),
    );
  });
});
