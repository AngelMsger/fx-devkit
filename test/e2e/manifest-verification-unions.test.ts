// Team-authored verifier alternatives must survive normal manifest loading and reach readonly setup planning.
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { expect, it } from 'vitest';
import { parse, stringify } from 'yaml';

import { disabledBundledTools, freshHome, fx, manifestDirOf } from './harness.js';

it('validates and previews command, JSON, file and provider checks without external services', () => {
  const home = freshHome();
  const root = freshHome();
  const source = manifestDirOf(home, 'example');
  const missingFile = path.join(root, 'personal-access');
  mkdirSync(path.join(source, 'manifest'), { recursive: true });
  writeFileSync(
    path.join(home, 'config.yaml'),
    stringify({
      default_workspace: 'example',
      agents: [],
      hooks: false,
      workspaces: { example: { root, source } },
    }),
  );
  writeFileSync(
    path.join(source, 'manifest/workspace.yaml'),
    stringify({
      schema_version: 2,
      providers: {
        'code-host': {
          provider: 'local-git',
          vars: { host: path.join(root, 'host'), user: 'fixture' },
        },
      },
      defaults: { branch: 'main' },
      repos: [{ name: 'api', upstream: path.join(root, 'api.git') }],
    }),
  );
  const baseline = parse(disabledBundledTools()) as { tools: object[] };
  const checks = [
    { id: 'command', kind: 'manual', title: 'Command readiness', verify: { command: ['check'] } },
    {
      id: 'json',
      kind: 'manual',
      title: 'JSON readiness',
      verify: { command: ['check'], json: { path: 'result.ready', equals: null } },
    },
    {
      id: 'file',
      kind: 'file',
      title: 'Provide access',
      expects: { path: missingFile },
      verify: { file: missingFile },
    },
    { id: 'provider', kind: 'manual', title: 'Provider identity', verify: { provider: 'whoami' } },
  ];
  writeFileSync(
    path.join(source, 'manifest/tools.yaml'),
    stringify({
      schema_version: 3,
      tools: [
        ...baseline.tools,
        {
          name: 'fixture-tool',
          install: [{ via: 'manual' }],
          auth: { command: [] },
          setup: checks,
        },
      ],
    }),
  );
  const env = { FX_HOME: home };
  for (const strict of [[], ['--strict']]) {
    const validation = fx(['manifest', 'validate', ...strict, '--format', 'json'], env, root);
    expect(validation.status, validation.stderr).toBe(0);
    expect(validation.json()).toMatchObject({ ok: true });
  }
  const plan = fx(['login', 'fixture-tool', '--list', '--format', 'json'], env, root);
  expect(plan.status, plan.stderr).toBe(0);
  expect(plan.json()).toMatchObject({
    items: [
      { id: 'fixture-tool.command', verify: { command: ['fixture-tool', 'check'] } },
      {
        id: 'fixture-tool.json',
        verify: {
          command: ['fixture-tool', 'check'],
          json: { path: 'result.ready', equals: null },
        },
      },
      { id: 'fixture-tool.file', verify: { file: missingFile } },
      { id: 'fixture-tool.provider', verify: { provider: 'whoami' } },
    ],
  });
  const preview = fx(
    ['login', 'fixture-tool', '--dry-run', '--no-input', '--format', 'json'],
    env,
    root,
  );
  expect(preview.status, preview.stderr).toBe(0);
  expect(preview.json()).toMatchObject({
    items: [
      {
        id: 'fixture-tool.command',
        result: 'would_ask',
        detail: 'manifest command is not trusted',
      },
      { id: 'fixture-tool.json', result: 'would_ask', detail: 'manifest command is not trusted' },
      { id: 'fixture-tool.file', result: 'would_ask', detail: `${missingFile} is missing` },
      { id: 'fixture-tool.provider', result: 'verified', detail: 'authenticated as fixture' },
    ],
  });
  expect(existsSync(missingFile)).toBe(false);
  expect(existsSync(path.join(home, 'trust.yaml'))).toBe(false);
  expect(existsSync(path.join(home, 'workspaces/example/local.yaml'))).toBe(false);
  writeFileSync(missingFile, 'fixture access');
  const ready = fx(
    ['login', 'fixture-tool', '--dry-run', '--no-input', '--format', 'json'],
    env,
    root,
  );
  expect(ready.status, ready.stderr).toBe(0);
  expect(ready.json()).toMatchObject({
    items: expect.arrayContaining([
      {
        id: 'fixture-tool.file',
        tool: 'fixture-tool',
        env: null,
        kind: 'file',
        title: 'Provide access',
        result: 'verified',
        detail: `${missingFile} exists`,
      },
    ]),
  });
});
