// The fact commands end to end: a real-shaped manifest (environments with
// notes, one uncovered repository, a members document with example.com
// people) in a temporary workspace, a shim jenkins-cli whose status is set
// by an environment variable, and a temporary FX_HOME.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { writeNodeShim } from '../platform.js';

import { freshHome, fx, repository, searchPath, tempDir } from './harness.js';

interface Stage {
  readonly ws: string;
  readonly shims: string;
  readonly env: Record<string, string>;
}

function stage(): Stage {
  const base = tempDir('fx-facts-e2e-');
  const shims = path.join(base, 'shims');
  mkdirSync(shims);
  const host = path.join(base, 'host', 'fx');
  mkdirSync(host, { recursive: true });
  repository(host, 'a', { README: 'a\n' });
  repository(host, 'off', { README: 'off\n' });
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
  const env = { FX_HOME: freshHome(), PATH: searchPath(shims) };
  const boot = fx(['init', ws, '--from', path.dirname(manifestDir), '--format', 'json'], env);
  expect(boot.status, boot.stderr).toBe(12);
  expect(boot.json()).toMatchObject({ preparation: { state: 'incomplete' }, registered: true });
  return { ws, shims, env };
}

function shim(dir: string, name: string, body: string): void {
  writeNodeShim(dir, name, body);
}

const json = ['--format', 'json'] as const;

// A jenkins-cli on the stage's PATH that is signed in only where FAKE_JENKINS_OK is 0;
// like the real one, `auth status` exits zero either way and says who is signed in.
function installJenkins(s: Stage): void {
  shim(
    s.shims,
    'jenkins-cli',
    'const a=process.argv.slice(2).join(" "); if(a==="--version") console.log("jenkins-cli 1.0.0"); else if(a==="auth status") console.log(JSON.stringify({authenticated:process.env.FAKE_JENKINS_OK==="0"})); else process.exit(2);',
  );
}

function signedIn(s: Stage): Record<string, string> {
  return { ...s.env, FAKE_JENKINS_OK: '0' };
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
interface MemberRow {
  readonly id: string;
  readonly display: string | null;
  readonly status: string;
  readonly areas: readonly string[];
}
interface CanAnswer {
  readonly status: string;
  readonly tool: string;
  readonly handoff: Handoff | null;
  readonly alternatives: string[];
}

describe('facts: where, member, can, derived docs', () => {
  it('keeps unpicked alias discovery and typo recovery available through the built CLI', () => {
    const s = stage();
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

  it('lists people by area and status, and opens a repository by printing its page', () => {
    const s = stage();
    const all = fx(['member', 'list', ...json], s.env, s.ws);
    expect(all.status, all.stderr).toBe(0);
    expect((all.json() as Items<MemberRow>).items).toEqual([
      { id: 'alice', display: 'Alice', status: 'active', areas: ['Platform'] },
      { id: 'bob', display: 'Bob', status: 'active', areas: ['Platform'] },
    ]);
    expect(fx(['member', 'list'], s.env, s.ws).stdout.split('\n')[0]).toMatch(
      /^id\s+display\s+status\s+areas$/,
    );
    expect(
      (
        fx(
          ['member', 'list', '--area', 'Platform', ...json],
          s.env,
          s.ws,
        ).json() as Items<MemberRow>
      ).items,
    ).toHaveLength(2);
    expect(
      (
        fx(
          ['member', 'list', '--status', 'resigned', ...json],
          s.env,
          s.ws,
        ).json() as Items<MemberRow>
      ).items,
    ).toEqual([]);
    const area = fx(['member', 'list', '--area', 'Platfrom', ...json], s.env, s.ws);
    expect(area.status).toBe(6);
    expect(area.error()).toMatchObject({
      code: 'AREA_NOT_FOUND',
      hint: 'Did you mean "Platform"?',
    });

    // Not a terminal, so the command prints the page instead of opening it.
    const open = fx(['repo', 'open', 'a', ...json], s.env, s.ws);
    expect(open.status, open.stderr).toBe(0);
    expect(open.json()).toMatchObject({ name: 'a', url: expect.stringContaining('/fx/a.git') });
    expect(open.stderr).not.toContain('BROWSER_OPEN_FAILED');
    const unknown = fx(['repo', 'open', 'nope', ...json], s.env, s.ws);
    expect(unknown.status).toBe(6);
    expect(unknown.error().code).toBe('REPO_NOT_FOUND');
  });

  it('answers where with what stands between this machine and each coordinate', () => {
    const s = stage();
    const row = (repo: string, platform: string, env = s.env): Coordinate => {
      const run = fx(['where', repo, '--env', 'dev', '--platform', platform, ...json], env, s.ws);
      expect(run.status, run.stderr).toBe(0);
      const [first] = (run.json() as Items<Coordinate>).items;
      if (first === undefined) throw new Error(`no ${platform} row`);
      return first;
    };

    expect(row('off', 'sentry')).toMatchObject({
      status: 'not_covered',
      ready: 'not_covered',
      command: null,
      notes: ['decommissioned'],
    });
    expect(row('a', 'jenkins')).toMatchObject({
      ready: 'missing_tool',
      handoff: { command: 'fx tool install jenkins-cli --workspace ws' },
    });
    installJenkins(s);
    expect(row('a', 'jenkins', { ...s.env, FAKE_JENKINS_OK: '1' })).toMatchObject({
      ready: 'unconfigured',
      handoff: {
        command: 'fx login jenkins-cli --workspace ws',
        user_steps: [{ id: 'jenkins-cli.login' }],
      },
    });
    expect(row('a', 'jenkins', signedIn(s))).toMatchObject({
      ready: 'ready',
      command: 'jenkins-cli build list services/a/dev',
    });
  });

  it('answers can with ready, not covered or no access, and the way out of each', () => {
    const s = stage();
    installJenkins(s);
    const can = (args: string[], env = s.env): CanAnswer => {
      const run = fx(['can', ...args, ...json], env, s.ws);
      expect(run.status, run.stderr).toBe(0);
      return run.json() as CanAnswer;
    };

    expect(can(['ci', '--env', 'dev'], signedIn(s))).toMatchObject({
      status: 'ready',
      tool: 'jenkins-cli',
    });
    const asked = fx(['can', ...json], s.env, s.ws);
    expect(asked.status, asked.stderr).toBe(0);
    expect((asked.json() as Items<{ capability: string }>).items).toContainEqual(
      expect.objectContaining({ capability: 'ci', platform: 'jenkins', tool: 'jenkins-cli' }),
    );
    expect(can(['log-store', '--env', 'selfhosted'])).toMatchObject({
      status: 'not_covered',
      alternatives: ['selfhosted declares no openobserve platform', 'fx doctor --workspace ws'],
    });
    expect(fx(['env', 'unpick', 'dev', ...json], s.env, s.ws).status).toBe(0);
    expect(can(['ci', '--env', 'dev'], signedIn(s))).toMatchObject({
      status: 'no_access',
      alternatives: ['fx env pick dev --workspace ws', 'fx doctor --workspace ws'],
    });
  });

  it('answers who a person is and who owns a repository from the members document', () => {
    const s = stage();

    const who = fx(['member', 'show', 'alice@example.com', ...json], s.env, s.ws);
    expect(who.status, who.stderr).toBe(0);
    expect((who.json() as Items<{ id: string }>).items.map((person) => person.id)).toEqual([
      'alice',
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
  });

  it('derives AGENTS.md without people or coordinates, and tells a stale guide from a foreign one', () => {
    const s = stage();
    const docsStage = (run: ReturnType<typeof fx>) =>
      (run.json() as { stages: { docs: Record<string, number> } }).stages.docs;
    const docsFinding = (): { level: string; fix?: string } | undefined =>
      (
        fx(['doctor', ...json], s.env, s.ws).json() as {
          findings: { group: string; id: string; level: string; fix?: string }[];
        }
      ).findings.find((f) => f.group === 'manifest' && f.id === 'docs');

    const derived = fx(['sync', '--only', 'docs', ...json], s.env, s.ws);
    expect(derived.status, derived.stderr).toBe(0);
    expect(docsStage(derived), 'init already derived the guide').toMatchObject({ unchanged: 1 });
    const agents = path.join(s.ws, 'AGENTS.md');
    const text = readFileSync(agents, 'utf8');
    expect(text).toContain('| `a` | fx | First |');
    expect(text).not.toContain('sentry.example.com');
    expect(text).not.toContain('alice');
    expect(text.startsWith('<!-- fx:derived from '), 'the root file announces its origin').toBe(
      true,
    );

    const pointer = path.join(s.ws, 'CLAUDE.md');
    writeFileSync(pointer, `${text.split('\n')[0]}\n# CLAUDE.md\n`);
    expect(docsFinding(), 'a pointer an earlier version derived is stale').toMatchObject({
      level: 'warn',
      fix: 'fx sync --only docs --workspace ws',
    });
    const retired = fx(['sync', '--only', 'docs', ...json], s.env, s.ws);
    expect(docsStage(retired)).toMatchObject({ removed: 1, unchanged: 1 });
    expect(existsSync(pointer)).toBe(false);

    writeFileSync(agents, `${text}\n## Ours\n\nRouting rules people wrote.\n`);
    expect(docsFinding(), 'a derived file is stale as soon as it differs').toMatchObject({
      level: 'warn',
      fix: 'fx sync --only docs --workspace ws',
    });

    writeFileSync(agents, text.split('\n').slice(1).join('\n'));
    const foreign = fx(['sync', '--only', 'docs', ...json], s.env, s.ws);
    expect(foreign.error().code).toBe('INPUT_REQUIRED');
    expect(readFileSync(agents, 'utf8').startsWith('<!-- fx:derived')).toBe(false);
    expect(docsFinding(), 'foreign is not stale, and not healthy either').toMatchObject({
      level: 'warn',
      fix: 'Move the file aside, then fx sync --only docs --workspace ws',
    });
  });
});
