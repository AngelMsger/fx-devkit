// The fact commands end to end: a real-shaped manifest (environments with
// notes, one uncovered repository, a members document with example.com
// people) in a temporary workspace, a shim jenkins-cli whose status is set
// by an environment variable, and a temporary FX_HOME.

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { writeNodeShim, runtimeTools, systemPath } from '../platform.js';

import { freshHome, fx } from './harness.js';

interface Stage {
  readonly ws: string;
  readonly shims: string;
  readonly env: Record<string, string>;
}

function bareWithCommit(host: string, base: string, name: string): void {
  const bare = path.join(host, `${name}.git`);
  const author = path.join(base, `author-${name}`);
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
  execFileSync('git', ['init', '--quiet', '--bare', '-b', 'main', bare]);
  execFileSync('git', ['clone', '-q', bare, author]);
  git('checkout', '-q', '-b', 'main');
  writeFileSync(path.join(author, 'README'), `${name}\n`);
  git('add', '.');
  git('commit', '-q', '-m', 'one');
  git('push', '-q', '-u', 'origin', 'main');
}

function stage(): Stage {
  const base = mkdtempSync(path.join(tmpdir(), 'fx-facts-e2e-'));
  const shims = path.join(base, 'shims');
  mkdirSync(shims);
  const host = path.join(base, 'host', 'fx');
  mkdirSync(host, { recursive: true });
  bareWithCommit(host, base, 'a');
  bareWithCommit(host, base, 'off');
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
      '  - { name: a, desc: First, aka: [], tags: [backend], obs: { svc: alpha } }',
      '  - { name: off, desc: Uncovered, tags: [legacy], obs: { covered: false, note: decommissioned } }',
      '',
    ].join('\n'),
  );
  writeFileSync(
    path.join(manifestDir, 'environments.yaml'),
    [
      'schema_version: 2',
      'platforms:',
      '  sentry: { provider: sentry, capability: error-tracker, vars: { host: sentry.example.com, org: fx }, command: "sentry issue list {org}/{slug} --json" }',
      '  openobserve: { provider: openobserve-cli, capability: log-store }',
      '  jenkins: { provider: jenkins-cli, capability: ci, vars: { host: jenkins.example.com } }',
      '  kube: { provider: kubectl, capability: cluster, note: read-only }',
      'envs:',
      '  dev:',
      '    label: Development',
      '    platforms:',
      '      sentry: { vars: { team: fx-dev, slug: "fx-{svc}-dev" }, confidence: unverified }',
      '      openobserve: { vars: { context: dev, stream: "fx_{svc}_dev" } }',
      '      jenkins: { vars: { path: "services/{repo}/dev" } }',
      '      kube: { vars: { kubeconfig: ~/.kube/dev, context: dev, namespace: default } }',
      '  selfhosted:',
      '    label: Self-hosted',
      '    platforms:',
      '      sentry: { vars: { team: oem, slug: "oem-{svc}" } }',
      '      jenkins: { vars: { path: "oem/{repo}/release" } }',
      '    note: no central log store',
      '',
    ].join('\n'),
  );
  writeFileSync(
    path.join(manifestDir, 'members.yaml'),
    [
      'schema_version: 1',
      'sensitive: true',
      'people:',
      '  - { id: alice, display: Alice, email: alice@example.com, accounts: { bitbucket: alice }, git_names: [Alice] }',
      '  - { id: bob, display: Bob, email: bob@example.com, git_names: [alice] }',
      'areas:',
      '  - group: Platform',
      '    lead: alice',
      '    scenarios: [{ name: Core, dev_lead: bob, roles: { backend: [alice, bob] }, repos: [a] }]',
      '',
    ].join('\n'),
  );
  const ws = path.join(base, 'ws');
  // Only the shims, node and git: whatever the machine has installed must not leak in.
  const tools = path.join(base, 'tools');
  mkdirSync(tools);
  runtimeTools(tools);
  const env = {
    FX_HOME: freshHome(),
    PATH: [shims, tools, ...systemPath()].join(path.delimiter),
  };
  const boot = fx(['init', ws, '--from', path.dirname(manifestDir), '--format', 'json'], env);
  expect(boot.status, boot.stderr).toBe(0);
  return { ws, shims, env };
}

function shim(dir: string, name: string, body: string): void {
  writeNodeShim(dir, name, body);
}

interface Items<T> {
  readonly items: readonly T[];
}
interface Handoff {
  readonly command: string;
  readonly user_steps: { id: string }[];
}
interface Coordinate {
  readonly platform: string;
  readonly status: string;
  readonly command: string | null;
  readonly confidence: string;
  readonly notes: string[];
  readonly ready: string | null;
  readonly handoff: Handoff | null;
}
interface CanAnswer {
  readonly status: string;
  readonly tool: string;
  readonly handoff: Handoff | null;
  readonly alternatives: string[];
}

describe('facts: where, member, can, derived docs, skill handshake', () => {
  it('keeps unpicked alias discovery and typo recovery available through the built CLI', () => {
    const s = stage();
    const json = ['--format', 'json'];
    const set = fx(['manifest', 'set', 'a', 'aka', '["backend"]', ...json], s.env, s.ws);
    expect(set.status, set.stderr).toBe(0);
    const unpick = fx(['repo', 'unpick', 'a', ...json], s.env, s.ws);
    expect(unpick.status, unpick.stderr).toBe(0);
    const show = fx(['repo', 'show', 'backend', ...json], s.env, s.ws);
    expect(show.status, show.stderr).toBe(0);
    expect(show.json()).toMatchObject({ name: 'a', picked: false, aka: ['backend'] });
    const typo = fx(['where', 'bakend', '--env', 'dev', '--no-check', ...json], s.env, s.ws);
    expect(typo.status).toBe(6);
    expect(typo.error()).toMatchObject({
      code: 'REPO_NOT_FOUND',
      hint: 'Did you mean "backend"?',
    });
    const where = fx(['where', 'backend', '--env', 'dev', '--no-check', ...json], s.env, s.ws);
    expect(where.status, where.stderr).toBe(0);
    expect((where.json() as Items<Coordinate>).items[0]?.command).toBe(
      'sentry issue list fx/fx-alpha-dev --json',
    );
  });

  it('prints verbose provider diagnostics on stderr without exposing credentials', () => {
    const s = stage();
    shim(
      s.shims,
      'jenkins-cli',
      'console.error("Authorization: Bearer private-token"); process.exit(4);',
    );
    const run = fx(
      [
        'where',
        'a',
        '--env',
        'dev',
        '--platform',
        'jenkins',
        '--no-check',
        '--probe',
        '--verbose',
        '--format',
        'json',
      ],
      s.env,
      s.ws,
    );
    expect(run.status, run.stderr).toBe(0);
    const diagnostic = run.stderr
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line) as { _diagnostic?: Record<string, unknown> })
      .find((line) => line._diagnostic !== undefined)?._diagnostic;
    expect(diagnostic).toMatchObject({
      kind: 'process',
      capability: 'ci',
      provider: 'jenkins-cli',
      binding: 'jenkins',
      exit_code: 4,
    });
    expect(run.stderr).not.toContain('private-token');
  });

  it('answers from the manifest, hands off when the machine is not ready, and keeps AGENTS.md honest', () => {
    const s = stage();
    const json = ['--format', 'json'] as const;

    const where = fx(['where', 'a', '--env', 'dev', '--no-check', ...json], s.env, s.ws);
    expect(where.status, where.stderr).toBe(0);
    const coordinates = (where.json() as Items<Coordinate>).items;
    expect(coordinates.map((c) => [c.platform, c.status, c.confidence, c.ready])).toEqual([
      ['sentry', 'located', 'unverified', null],
      ['openobserve', 'located', 'derived', null],
      ['jenkins', 'located', 'derived', null],
      ['kube', 'located', 'derived', null],
    ]);
    expect(coordinates[0]?.command).toBe('sentry issue list fx/fx-alpha-dev --json');
    expect(coordinates[2]?.command).toBe('jenkins-cli build list services/a/dev');
    const off = (
      fx(
        ['where', 'off', '--env', 'dev', '--platform', 'sentry', ...json],
        s.env,
        s.ws,
      ).json() as Items<Coordinate>
    ).items[0];
    expect(off).toMatchObject({
      status: 'not_covered',
      ready: 'not_covered',
      command: null,
      notes: ['decommissioned'],
    });

    const who = fx(['member', 'show', 'alice@example.com', ...json], s.env, s.ws);
    expect((who.json() as Items<{ id: string; matched_by: string }>).items).toEqual([
      expect.objectContaining({ id: 'alice', matched_by: 'email' }),
    ]);
    const byGit = (
      fx(['member', 'show', 'alice', ...json], s.env, s.ws).json() as Items<{
        id: string;
        matched_by: string;
      }>
    ).items;
    expect(byGit.map((p) => [p.id, p.matched_by])).toEqual([
      ['alice', 'id'],
      ['bob', 'git_name'],
    ]);
    const owners = fx(['repo', 'show', 'a', ...json], s.env, s.ws).json() as {
      owners: { scenario: string; devLead: { id: string } }[];
    };
    expect(owners.owners).toEqual([
      expect.objectContaining({
        scenario: 'Core',
        devLead: expect.objectContaining({ id: 'bob' }),
      }),
    ]);
    const human = fx(['repo', 'show', 'a'], s.env, s.ws).stdout;
    expect(human).toContain('dev lead: Bob (bob@example.com)');
    expect(human).toContain('backend: Alice (alice@example.com), Bob (bob@example.com)');

    const jenkinsRow = (args: string[], env = s.env): Coordinate => {
      const run = fx(
        ['where', 'a', '--env', 'dev', '--platform', 'jenkins', ...args, ...json],
        env,
        s.ws,
      );
      expect(run.status, run.stderr).toBe(0);
      const [row] = (run.json() as Items<Coordinate>).items;
      if (row === undefined) throw new Error('no jenkins row');
      return row;
    };
    const can = (args: string[], env = s.env): CanAnswer => {
      const run = fx(['can', ...args, ...json], env, s.ws);
      expect(run.status, run.stderr).toBe(0);
      return run.json() as CanAnswer;
    };
    expect(jenkinsRow([])).toMatchObject({
      ready: 'missing_tool',
      handoff: { command: 'fx tool install jenkins-cli' },
    });
    shim(
      s.shims,
      'jenkins-cli',
      'const a=process.argv.slice(2).join(" "); if(a==="--version") console.log("jenkins-cli 1.0.0"); else process.exit(a==="auth status"?Number(process.env.FAKE_JENKINS_OK??1):2);',
    );
    expect(jenkinsRow([], { ...s.env, FAKE_JENKINS_OK: '1' })).toMatchObject({
      ready: 'unconfigured',
      handoff: { command: 'fx login jenkins-cli', user_steps: [{ id: 'jenkins-cli.login' }] },
    });
    const ready = jenkinsRow([], { ...s.env, FAKE_JENKINS_OK: '0' });
    expect(ready.ready).toBe('ready');
    expect(ready.command).toBe('jenkins-cli build list services/a/dev');
    expect(can(['ci', '--env', 'dev'], { ...s.env, FAKE_JENKINS_OK: '0' })).toMatchObject({
      status: 'ready',
      tool: 'jenkins-cli',
    });
    expect(can(['log-store', '--env', 'selfhosted'])).toMatchObject({
      status: 'not_covered',
      alternatives: ['no central log store', 'fx doctor'],
    });
    expect(fx(['env', 'unpick', 'dev', ...json], s.env, s.ws).status).toBe(0);
    expect(can(['ci', '--env', 'dev'], { ...s.env, FAKE_JENKINS_OK: '0' })).toMatchObject({
      status: 'no_access',
      alternatives: ['fx env pick dev', 'fx doctor'],
    });

    const docsStage = (run: ReturnType<typeof fx>) =>
      (run.json() as { stages: { docs: Record<string, number> } }).stages.docs;
    const derived = fx(['sync', '--only', 'docs', ...json], s.env, s.ws);
    expect(derived.status, derived.stderr).toBe(0);
    expect(docsStage(derived), 'init already derived both files').toMatchObject({ unchanged: 2 });
    const agents = path.join(s.ws, 'AGENTS.md');
    expect(existsSync(path.join(s.ws, 'CLAUDE.md'))).toBe(true);
    const text = readFileSync(agents, 'utf8');
    expect(text).toContain('| `a` | fx | First |');
    expect(text).not.toContain('sentry.example.com');
    expect(text).not.toContain('alice');
    expect(text.startsWith('<!-- fx:derived from '), 'the root file announces its origin').toBe(
      true,
    );
    const docsFinding = (): { level: string; fix?: string } | undefined =>
      (
        fx(['doctor', ...json], s.env, s.ws).json() as {
          findings: { group: string; id: string; level: string; fix?: string }[];
        }
      ).findings.find((f) => f.group === 'manifest' && f.id === 'docs');
    writeFileSync(agents, `${text}\n## Ours\n\nRouting rules people wrote.\n`);
    expect(docsFinding(), 'a derived file is stale as soon as it differs').toMatchObject({
      level: 'warn',
      fix: 'fx sync --only docs',
    });
    writeFileSync(agents, text.split('\n').slice(1).join('\n'));
    const foreign = fx(['sync', '--only', 'docs', ...json], s.env, s.ws);
    expect(foreign.error().code).toBe('INPUT_REQUIRED');
    expect(readFileSync(agents, 'utf8').startsWith('<!-- fx:derived')).toBe(false);
    expect(docsFinding(), 'foreign is not stale, and not healthy either').toMatchObject({
      level: 'warn',
      fix: 'move the file aside, then fx sync --only docs',
    });

    const agentEnv = { ...s.env, FX_AGENTS: 'claude-code' };
    const unloaded = fx(['repo', 'list', ...json], agentEnv, s.ws);
    expect(unloaded.stderr).toMatch(/SKILL_(MISSING|OUTDATED|AVAILABLE)/);
    expect(
      fx(['repo', 'list', ...json], { ...agentEnv, FX_SKILL_LOADED: '1' }, s.ws).stderr,
    ).not.toContain('SKILL_');
    expect(fx(['repo', 'list'], agentEnv, s.ws).stderr).toContain('SKILL_MISSING');
  });
});
