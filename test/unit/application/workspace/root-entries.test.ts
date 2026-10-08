import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { checkRoot } from '../../../../src/application/doctor/root.js';
import { findingCheck } from '../../../../src/application/preparation.js';
import {
  strayRootEntries,
  type RootInventory,
} from '../../../../src/application/workspace/root-entries.js';
import { describeProvider } from '../../../../src/composition/registry.js';
import { FakeAgentHost } from '../../../fakes/fake-agent-host.js';
import { fakeLoginDeps } from '../../../fakes/fake-login-deps.js';
import { harness, MANIFEST_DIR, ROOT, type Harness } from '../../../fakes/workspace.js';

const WORKSPACE = `schema_version: 1
defaults: {host: 'ssh://git@git.example.com:12345', upstream_project: fx, branch: dev}
projects: {fx: {label: Platform}}
repos:
  - {name: fx-example-api, desc: Backend monolith}
  - {name: fx-example-auth, desc: Accounts and login}
`;

const SENTRY_SERVICE = `schema_version: 2
platforms:
  errors: {provider: sentry, capability: error-tracker, service: {base_url: 'https://sentry.example.com', org: team}}
envs: {dev: {platforms: {errors: {}}}}
`;

const inventory: RootInventory = {
  hosts: [new FakeAgentHost('claude', true)],
  login: { ...fakeLoginDeps({}), describeProvider },
};

async function root(
  entries: Record<string, string>,
  dirs: readonly string[] = [],
): Promise<Harness> {
  const h = await harness({
    workspace: WORKSPACE,
    // One declared repository is left unselected and one exists only on this machine.
    local: {
      scope: { repos: ['fx-example-api'] },
      repos: [{ name: 'scratch-tool', path: path.join(ROOT, 'tools/scratch-tool') }],
    },
    files: {
      [`${MANIFEST_DIR}/manifest/environments.yaml`]: SENTRY_SERVICE,
      ...Object.fromEntries(
        Object.entries(entries).map(([name, text]) => [path.join(ROOT, name), text]),
      ),
    },
  });
  for (const dir of dirs) h.fs.mkdir(path.join(ROOT, dir));
  return h;
}

describe('stray root entries', () => {
  it('reports nothing when every entry is a checkout, a guide, host or service state, or the workbench', async () => {
    const h = await root(
      {
        'AGENTS.md': 'guide',
        'CLAUDE.md': 'pointer',
        '.sentryclirc': '[defaults]',
        '.DS_Store': '',
        '.claude/settings.local.json': '{}',
        '.workbench/2026-01-05-audit/report.md': 'report',
      },
      ['fx-example-api', 'fx-example-auth', 'tools/scratch-tool', '.vscode'],
    );
    expect(await strayRootEntries(h.deps, inventory)).toEqual([]);
    expect((await checkRoot(h.deps, inventory)).map((f) => [f.id, f.level])).toEqual([
      ['entries', 'ok'],
    ]);
  });

  it('names what is left over by kind, hidden or not, in a stable order', async () => {
    const h = await root(
      { 'demo.html': '<html>', 'vendor-fork/.git/HEAD': 'ref: refs/heads/main' },
      ['analysis', '.worktrees'],
    );
    await h.fs.link('/elsewhere/notes', path.join(ROOT, 'notes'));
    expect(await strayRootEntries(h.deps, inventory)).toEqual([
      { name: '.worktrees', kind: 'directory' },
      { name: 'analysis', kind: 'directory' },
      { name: 'demo.html', kind: 'file' },
      { name: 'notes', kind: 'link' },
      { name: 'vendor-fork', kind: 'checkout' },
    ]);
  });

  it('warns without blocking preparation, and offers a command only for an unregistered checkout', async () => {
    const h = await root({
      'demo.html': '<html>',
      'vendor-fork/.git/HEAD': 'ref: refs/heads/main',
    });
    const findings = await checkRoot(h.deps, inventory);
    expect(findings.map((f) => [f.group, f.id, f.level, f.fix])).toEqual([
      ['root', 'demo.html', 'warn', undefined],
      ['root', 'vendor-fork', 'warn', 'fx repo add vendor-fork --workspace fx'],
    ]);
    expect(findings.map((f) => findingCheck(f).required)).toEqual([false, false]);
  });
});
