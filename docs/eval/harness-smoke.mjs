// Prepare a new, disposable lifecycle sandbox without copying credentials or
// touching a real workspace. Native trust and authentication remain human steps.
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const target = process.argv[2];
if (!target || !path.isAbsolute(target)) {
  throw new Error('Pass a new absolute sandbox directory under the system temporary directory.');
}
const parent = realpathSync(path.dirname(target));
const temporaryRoots = [tmpdir(), '/tmp']
  .filter(existsSync)
  .map((directory) => realpathSync(directory));
if (!temporaryRoots.some((root) => parent === root || parent.startsWith(`${root}${path.sep}`)))
  throw new Error('The smoke workspace must be inside a system temporary directory.');
mkdirSync(target);
const root = path.join(target, 'root');
const fxHome = path.join(target, 'fx-home');
const userHome = path.join(target, 'user-home');
const source = path.join(fxHome, 'workspaces/smoke/source');
for (const directory of [root, userHome, path.join(source, 'manifest')])
  mkdirSync(directory, { recursive: true });
writeFileSync(
  path.join(fxHome, 'config.yaml'),
  `agents: [claude-code, codex, grok, pi]\nworkspaces:\n  smoke: { root: ${JSON.stringify(root)} }\n`,
);
writeFileSync(
  path.join(source, 'manifest/workspace.yaml'),
  'schema_version: 2\ndefaults: { upstream_project: team, branch: main }\nrepos: [{name: example, project: team, upstream: https://git.example.com/team/example.git}]\n',
);
writeFileSync(
  path.join(source, 'AGENTS.md'),
  'This is an isolated lifecycle smoke workspace. Do not use tools or change files during the native context check.\n',
);
const bin = fileURLToPath(new URL('../../bin/fx.js', import.meta.url));
const env = { ...process.env, HOME: userHome, FX_HOME: fxHome, FX_UPDATE_CHECK: '0' };
for (const args of [
  ['hook', 'inject'],
  ['sync', '--only', 'docs', '--no-refresh-manifest'],
]) {
  const result = spawnSync(
    process.execPath,
    [bin, ...args, '--workspace', 'smoke', '--format', 'json'],
    { cwd: root, env, encoding: 'utf8' },
  );
  if (result.status !== 0) throw new Error(result.stderr);
}
const stateFile = path.join(fxHome, 'workspaces/smoke/hooks.json');
const state = JSON.parse(readFileSync(stateFile, 'utf8'));
state.observations = [
  {
    checkedAt: Date.now(),
    phase: 'smoke',
    code: `FX_SMOKE_${randomUUID().replaceAll('-', '')}`,
    command: null,
  },
];
writeFileSync(stateFile, JSON.stringify(state));
process.stdout.write(
  `${JSON.stringify({ root, fx_home: fxHome, user_home: userHome, next_steps: ['Review native project and hook trust in each host.', 'Use FX_READ_ONLY=1 with the native host to check context without global Skill writes.', 'Do not copy credentials or bypass native trust.'] })}\n`,
);
