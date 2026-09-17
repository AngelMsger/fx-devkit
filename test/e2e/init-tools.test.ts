// Init drives a fake npm and private executable directory; no real packages are installed.
import { execFileSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

import { writeNodeShim } from '../platform.js';

import { freshHome, fx, manifestDirOf, userHome } from './harness.js';

function fixture() {
  const root = mkdtempSync(path.join(tmpdir(), 'fx-init-tools-'));
  const shims = path.join(root, 'bin');
  const template = path.join(root, 'template');
  mkdirSync(shims);
  mkdirSync(template);
  const receipt = path.join(root, 'npm-calls.json');
  const skillReceipt = path.join(root, 'skill-installed');
  writeNodeShim(
    template,
    'fixture-init-tool',
    `if(process.argv.includes('--version')) console.log('1.2.3'); else require('node:fs').writeFileSync(${JSON.stringify(skillReceipt)},'installed');`,
  );
  const shimFiles = readdirSync(template);
  writeNodeShim(
    shims,
    'npm',
    `const fs=require('node:fs'); const target=${JSON.stringify(receipt)}; const calls=fs.existsSync(target)?JSON.parse(fs.readFileSync(target,'utf8')):[]; calls.push(process.argv.slice(2)); fs.writeFileSync(target,JSON.stringify(calls)); for(const file of ${JSON.stringify(shimFiles)}) fs.copyFileSync(require('node:path').join(${JSON.stringify(template)},file),require('node:path').join(${JSON.stringify(shims)},file));`,
  );
  const host = path.join(root, 'host', 'team');
  mkdirSync(host, { recursive: true });
  execFileSync('git', ['init', '--quiet', '--bare', '-b', 'main', path.join(host, 'sample.git')]);
  const source = path.join(root, 'source');
  const manifest = path.join(source, 'manifest');
  mkdirSync(manifest, { recursive: true });
  writeFileSync(
    path.join(manifest, 'workspace.yaml'),
    `schema_version: 2
providers:
  code-host: {provider: local-git, vars: {host: ${path.dirname(host)}, user: fixture}}
defaults: {upstream_project: team, branch: main}
projects: {team: {label: Fixture, contact: fixture}}
repos: [{name: sample, desc: Fixture}]
`,
  );
  const baseline = parse(readFileSync('defaults/tools.yaml', 'utf8')) as {
    tools: { name: string }[];
  };
  writeFileSync(
    path.join(manifest, 'tools.yaml'),
    `schema_version: 2
tools:
${baseline.tools.map((t) => `  - {name: ${t.name}, enabled: false}`).join('\n')}
  - name: fixture-init-tool
    install_on_init: true
    min_version: '1.0.0'
    install: [{via: npm, spec: '@example/init-tool'}]
`,
  );
  const home = freshHome();
  writeFileSync(path.join(home, 'config.yaml'), 'agents: [claude-code]\n');
  return {
    root,
    shims,
    shimFiles,
    source,
    receipt,
    skillReceipt,
    workspace: path.join(root, 'workspace'),
    env: { FX_HOME: home, PATH: `${shims}${path.delimiter}${process.env.PATH}` },
  };
}

describe('manifest opt-in during workspace initialization', () => {
  it('previews without installing, requires trust, installs before Skills, and leaves later sync read-only for tools', () => {
    const f = fixture();
    const args = ['init', f.workspace, '--from', f.source, '--format', 'json'];
    const preview = fx([...args, '--dry-run'], f.env);
    expect(preview.status, preview.stderr).toBe(0);
    expect(preview.json()).toMatchObject({ tool_install: null, written: false });
    expect(existsSync(f.receipt)).toBe(false);
    expect(existsSync(f.workspace)).toBe(false);
    const locked = fx(args, { ...f.env, FX_READ_ONLY: '1' });
    expect(locked.error().code).toBe('READONLY_BLOCKED');
    expect(existsSync(f.receipt)).toBe(false);
    const untrusted = fx([...args, '--no-input'], f.env);
    expect(untrusted.error().code).toBe('VECTOR_UNTRUSTED');
    expect(existsSync(f.receipt)).toBe(false);
    const installed = fx([...args, '--yes'], f.env);
    expect(installed.status, installed.stderr).toBe(0);
    expect(installed.json()).toMatchObject({
      tool_install: [{ name: 'fixture-init-tool', ran: true, code: 0, version_after: '1.2.3' }],
    });
    expect(JSON.parse(readFileSync(f.receipt, 'utf8'))).toEqual([
      ['install', '-g', '@example/init-tool@latest'],
    ]);
    expect(existsSync(f.skillReceipt)).toBe(true);
    const history = fx(['tool', 'history', 'fixture-init-tool', '--format', 'json'], f.env);
    expect(history.status, history.stderr).toBe(0);
    expect(history.json()).toMatchObject({
      items: [
        { operation: 'init', workspace: 'workspace', event: 'started', code: null },
        { operation: 'init', event: 'installed', code: 0 },
        { operation: 'init', event: 'finished', version_after: '1.2.3' },
      ],
      has_more: false,
    });
    const again = fx([...args, '--yes'], f.env);
    expect(again.status, again.stderr).toBe(0);
    expect(again.json()).toMatchObject({ tool_install: [] });
    for (const file of f.shimFiles) rmSync(path.join(f.shims, file), { force: true });
    const sync = fx(['sync', '--only', 'tools', '--format', 'json'], f.env, f.workspace);
    expect(sync.status, sync.stderr).toBe(0);
    expect(JSON.parse(readFileSync(f.receipt, 'utf8'))).toHaveLength(1);
    // Confirm the harness used its isolated user directory, not a real host Skill path.
    expect(userHome).toContain('fx-user-home-');
  });
});

// Fake package operations persist across invocations, including manifest removal.
describe('tool installation lifecycle', () => {
  it('records explicit installs and updates and warns after the last manifest requirement disappears', () => {
    const f = fixture();
    const boot = fx(['init', f.workspace, '--from', f.source, '--yes', '--format', 'json'], f.env);
    expect(boot.status, boot.stderr).toBe(0);
    for (const action of ['install', 'update']) {
      const result = fx(
        ['tool', action, 'fixture-init-tool', '--format', 'json'],
        f.env,
        f.workspace,
      );
      expect(result.status, result.stderr).toBe(0);
    }
    const before = readFileSync(path.join(f.env.FX_HOME, 'tool-history.json'), 'utf8');
    const preview = fx(
      ['tool', 'update', 'fixture-init-tool', '--dry-run', '--format', 'json'],
      f.env,
      f.workspace,
    );
    expect(preview.status, preview.stderr).toBe(0);
    expect(readFileSync(path.join(f.env.FX_HOME, 'tool-history.json'), 'utf8')).toBe(before);
    const toolsFile = path.join(
      manifestDirOf(f.env.FX_HOME, 'workspace'),
      'manifest',
      'tools.yaml',
    );
    writeFileSync(
      toolsFile,
      readFileSync(toolsFile, 'utf8').replace(
        /  - name: fixture-init-tool[\s\S]*$/,
        '  - {name: fixture-manual, enabled: false, install: [{via: manual}]}\n',
      ),
    );
    const installed = fx(['tool', 'installed', '--format', 'json'], f.env);
    expect(installed.status, installed.stderr).toBe(0);
    expect(installed.json()).toMatchObject({
      items: [{ name: 'fixture-init-tool', state: 'unused', required_by: [] }],
      has_more: false,
    });
    const sync = fx(['sync', '--only', 'tools', '--format', 'json'], f.env, f.workspace);
    expect(sync.status, sync.stderr).toBe(0);
    expect(sync.json()).toMatchObject({
      stage_details: { tools: { installations: [{ state: 'unused' }] } },
    });
    expect(sync.stderr).toContain('TOOL_UNUSED');
    const doctor = fx(['doctor', '--format', 'json'], f.env, f.workspace);
    expect(doctor.status, doctor.stderr).toBe(0);
    expect(doctor.json()).toMatchObject({
      findings: expect.arrayContaining([
        expect.objectContaining({
          group: 'tools',
          level: 'warn',
          evidence: { installation: expect.objectContaining({ state: 'unused' }) },
        }),
      ]),
    });
    const history = fx(['tool', 'history', 'fixture-init-tool', '--format', 'json'], f.env);
    expect(history.json()).toMatchObject({
      items: expect.arrayContaining([
        expect.objectContaining({ operation: 'init', event: 'finished' }),
        expect.objectContaining({ operation: 'install', event: 'finished' }),
        expect.objectContaining({ operation: 'update', event: 'finished' }),
      ]),
    });
    expect(JSON.parse(readFileSync(f.receipt, 'utf8'))).toHaveLength(3);
    expect(readFileSync(path.join(f.env.FX_HOME, 'tool-history.json'), 'utf8')).toBe(before);
  });
});
