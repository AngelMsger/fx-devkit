// Login and doctor end to end: shim CLIs on a private PATH answer their
// status checks from environment variables, kubeconfigs live in a temporary
// directory, and the personal layer sits in a temporary FX_HOME.

import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { writeNodeShim } from '../platform.js';

import { freshHome, fx } from './harness.js';

interface Stage {
  readonly ws: string;
  readonly kube: string;
  readonly env: Record<string, string>;
}

const SHIMS: Record<string, string> = {
  'bitbucket-cli':
    'if(process.argv[2]==="--version") console.log("bitbucket-cli 1.0.0"); else { console.log(JSON.stringify({configured: process.env.FAKE_BB_OK === \"0\"})); process.exit(Number(process.env.FAKE_BB_OK??1)); }',
  'openobserve-cli':
    'const a=process.argv.slice(2).join(" "); if(a==="--version") console.log("openobserve-cli 1.0.0"); else process.exit(a==="auth status --use-context test"?Number(process.env.FAKE_OO_OK??1):2);',
  kubectl:
    'const a=process.argv.slice(2).join(" "); if(a==="version --client") console.log("Client Version: v1.30.0"); else process.exit(a.includes("auth can-i")?Number(process.env.FAKE_KUBE_OK??1):2);',
};

function stage(): Stage {
  const base = mkdtempSync(path.join(tmpdir(), 'fx-setup-e2e-'));
  const shims = path.join(base, 'shims');
  mkdirSync(shims);
  for (const [name, body] of Object.entries(SHIMS)) {
    writeNodeShim(shims, name, body);
  }
  const kube = path.join(base, 'kube');
  mkdirSync(kube);

  const host = path.join(base, 'host', 'fx');
  mkdirSync(host, { recursive: true });
  execFileSync('git', ['init', '--quiet', '--bare', '-b', 'main', path.join(host, 'a.git')]);
  const author = path.join(base, 'author');
  const git = (...args: string[]): void => {
    execFileSync('git', args, {
      cwd: author,
      env: {
        ...process.env,
        GIT_AUTHOR_NAME: 'T',
        GIT_AUTHOR_EMAIL: 't@example.com',
        GIT_COMMITTER_NAME: 'T',
        GIT_COMMITTER_EMAIL: 't@example.com',
      },
    });
  };
  execFileSync('git', ['clone', '-q', path.join(host, 'a.git'), author]);
  git('checkout', '-q', '-b', 'main');
  writeFileSync(path.join(author, 'README'), 'a\n');
  git('add', '.');
  git('commit', '-q', '-m', 'one');
  git('push', '-q', '-u', 'origin', 'main');
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
    path.join(manifestDir, 'environments.yaml'),
    [
      'schema_version: 2',
      'platforms:',
      '  openobserve: { provider: openobserve-cli, capability: log-store }',
      '  kube: { provider: kubectl, capability: cluster }',
      'envs:',
      '  test:',
      '    label: Test',
      '    platforms:',
      '      openobserve: { vars: { context: test, stream: "fx_{svc}_test" } }',
      '      kube:',
      `        vars: { kubeconfig: ${kube}/test.yaml, context: test, namespace: apps }`,
      '        setup: { source: https://rancher.example.com/test }',
      '  selfhosted:',
      '    label: Self-hosted',
      '    platforms:',
      `      kube: { vars: { kubeconfig: ${kube}/selfhosted.yaml, context: oem } }`,
      '',
    ].join('\n'),
  );
  const ws = path.join(base, 'ws');
  writeFileSync(
    path.join(manifestDir, 'tools.yaml'),
    "schema_version: 2\ntools:\n  - { name: kubectl, min_version: '1.30.0' }\n",
  );
  const env = {
    FX_HOME: freshHome(),
    PATH: `${shims}${path.delimiter}${process.env['PATH'] ?? ''}`,
    FAKE_BB_OK: '0',
    FAKE_OO_OK: '1',
    FAKE_KUBE_OK: '1',
  };
  const boot = fx(
    ['init', '--details', ws, '--from', path.dirname(manifestDir), '--format', 'json'],
    env,
  );
  expect(boot.status, boot.stderr).toBe(0);
  return { ws, kube, env };
}

interface Items<T> {
  readonly items: readonly T[];
}
interface Finding {
  readonly group: string;
  readonly id: string;
  readonly level: string;
  readonly fix?: string;
}
interface Report {
  readonly ok: boolean;
  readonly findings: readonly Finding[];
}

describe('login and doctor', () => {
  it('returns structured selector errors even when quiet mode suppresses notices', () => {
    const s = stage();
    const cases = [
      { args: ['login', 'bitbuckt-cli', '--list'], code: 'TOOL_UNKNOWN' },
      { args: ['login', '--env', 'tset'], code: 'ENV_NOT_FOUND' },
      { args: ['doctor', '--fix', '--tool', 'bitbuckt-cli'], code: 'TOOL_UNKNOWN' },
      { args: ['doctor', '--fix', '--env', 'tset'], code: 'ENV_NOT_FOUND' },
    ];
    for (const input of cases) {
      const result = fx([...input.args, '--quiet', '--no-input', '--format', 'json'], s.env, s.ws);
      expect(result.status, result.stderr).toBe(6);
      expect(result.stdout).toBe('');
      expect(result.error()).toMatchObject({ category: 'not_found', code: input.code });
    }
  });

  it('plans from the manifest, hands off to a person, verifies, and narrows with env unpick', () => {
    const s = stage();
    const ids = (run: ReturnType<typeof fx>): string[] =>
      (run.json() as Items<{ id: string }>).items.map((i) => i.id);

    const listed = fx(['login', '--list', '--format', 'json'], s.env, s.ws);
    expect(listed.status, listed.stderr).toBe(0);
    expect(ids(listed)).toEqual([
      'openobserve-cli.context@test',
      'kubectl.kubeconfig@test',
      'kubectl.access@test',
      'kubectl.kubeconfig@selfhosted',
      'kubectl.access@selfhosted',
    ]);

    const handoff = fx(
      ['login', '--no-input', '--format', 'json'],
      { ...s.env, FAKE_OO_OK: '1' },
      s.ws,
    );
    expect(handoff.status).toBe(3);
    expect(handoff.stdout).toBe('');
    const err = handoff.error() as ReturnType<typeof handoff.error> & {
      handoff: {
        user_steps: { id: string; kind: string; open?: string; command?: string[] }[];
        command: string;
      };
    };
    expect(err.code).toBe('LOGIN_REQUIRED');
    expect(err.handoff.user_steps.map((u) => [u.id, u.kind])).toEqual([
      ['openobserve-cli.context@test', 'run'],
      ['kubectl.kubeconfig@test', 'file'],
      ['kubectl.kubeconfig@selfhosted', 'file'],
    ]);
    expect(err.handoff.user_steps[0]?.command).toEqual([
      'openobserve-cli',
      'config',
      'init',
      '--context',
      'test',
    ]);
    expect(err.handoff.user_steps[1]?.open).toBe('https://rancher.example.com/test');
    expect(err.handoff.command).toBe(
      'fx login openobserve-cli kubectl --env test --env selfhosted',
    );

    writeFileSync(path.join(s.kube, 'test.yaml'), 'k');
    writeFileSync(path.join(s.kube, 'selfhosted.yaml'), 'k');
    const healthy = fx(
      ['doctor', '--details', '--format', 'json'],
      { ...s.env, FAKE_OO_OK: '0', FAKE_KUBE_OK: '0' },
      s.ws,
    );
    expect(healthy.status, healthy.stderr).toBe(0);
    const report = healthy.json() as Report;
    expect(report.findings.filter((f) => f.group === 'login').map((f) => f.level)).toEqual([
      'ok',
      'ok',
      'ok',
      'ok',
      'ok',
    ]);
    expect(report.findings.filter((f) => f.level === 'fail')).toEqual([]);
    expect(report.ok).toBe(true);

    const unpick = fx(['env', 'unpick', 'selfhosted', '--format', 'json'], s.env, s.ws);
    expect(unpick.status, unpick.stderr).toBe(0);
    expect(ids(fx(['login', '--list', '--format', 'json'], s.env, s.ws))).toEqual([
      'openobserve-cli.context@test',
      'kubectl.kubeconfig@test',
      'kubectl.access@test',
    ]);

    const broken = fx(
      ['doctor', '--details', '--env', 'test', '--format', 'json'],
      { ...s.env, FAKE_OO_OK: '1', FAKE_KUBE_OK: '0' },
      s.ws,
    );
    const finding = (broken.json() as Report).findings.find(
      (f) => f.id === 'openobserve-cli.context@test',
    );
    expect(finding).toMatchObject({ level: 'warn', fix: 'fx login openobserve-cli --env test' });
    expect(broken.stderr).toContain('DOCTOR_OK');
  });
});
