import { describe, expect, it } from 'vitest';

import { loadTools } from '../../../../src/domain/manifest/loader.js';
import { mergeTools } from '../../../../src/domain/manifest/overlay.js';
import type { Toolchain } from '../../../../src/domain/manifest/types.js';

const base: Toolchain = {
  schema_version: 2,
  min_cli: '0.1.0',
  defaults: {
    version_args: ['--version'],
    install: [{ via: 'npm' }],
    skill: { command: ['skill', 'install'], agent_flag: '--agent' },
    auth: { command: ['auth', 'status'] },
  },
  tools: [
    {
      name: 'bitbucket-cli',
      desc: 'Bitbucket',
      docs: 'https://docs.example.com/bitbucket-cli',
      min_version: '0.14.0',
      install: [{ via: 'npm', spec: '@example/bitbucket-cli' }],
      setup: [
        {
          id: 'token',
          kind: 'manual',
          title: 'Create a token',
          verify: { command: ['auth', 'status'] },
        },
        {
          id: 'login',
          kind: 'run',
          title: 'Log in',
          run: ['auth', 'login'],
          verify: { command: ['auth', 'status'] },
        },
      ],
    },
    { name: 'jira-cli', desc: 'Jira' },
  ],
};

const cli = { cliVersion: '1.0.0' };

describe('mergeTools', () => {
  it('overrides scalars, keeps the rest, and records where each field came from', () => {
    const { toolchain, provenance } = mergeTools(base, {
      schema_version: 2,
      tools: [{ name: 'bitbucket-cli', min_version: '0.16.0' }],
    });
    const tool = toolchain.tools[0]!;
    expect(tool.min_version).toBe('0.16.0');
    expect(tool.desc).toBe('Bitbucket');
    expect(provenance['bitbucket-cli']?.['min_version']).toBe('patch');
    expect(provenance['bitbucket-cli']?.['desc']).toBe('base');
  });

  it('deletes a field the patch sets to null', () => {
    const { toolchain } = mergeTools(
      base,
      { schema_version: 2, tools: [{ name: 'bitbucket-cli' }] },
      { deletions: [['tools', 0, 'docs']] },
    );
    expect(toolchain.tools[0]).not.toHaveProperty('docs');
  });

  it('applies deletions uniformly at the top level, in defaults, and in nested fields', () => {
    const { toolchain } = mergeTools(
      base,
      { schema_version: 2, defaults: {}, tools: [] },
      {
        deletions: [
          ['min_cli'],
          ['defaults', 'auth'],
          ['defaults', 'install'],
          ['defaults', 'skill', 'agent_flag'],
        ],
      },
    );
    expect(toolchain).not.toHaveProperty('min_cli');
    expect(toolchain.defaults).toEqual({
      version_args: ['--version'],
      skill: { command: ['skill', 'install'] },
    });
  });

  it('keeps a disabled tool in the list, marked disabled', () => {
    const { toolchain } = mergeTools(base, {
      schema_version: 2,
      tools: [{ name: 'jira-cli', enabled: false }],
    });
    expect(toolchain.tools.find((t) => t.name === 'jira-cli')).toMatchObject({
      desc: 'Jira',
      enabled: false,
    });
  });

  it('merges setup steps by id and install methods by installer and spec', () => {
    const { toolchain } = mergeTools(base, {
      schema_version: 2,
      tools: [
        {
          name: 'bitbucket-cli',
          setup: [
            {
              id: 'token',
              kind: 'manual',
              title: 'Create a token on the intranet page',
              verify: { command: ['auth', 'status'] },
            },
          ],
          install: [
            { via: 'npm', spec: '@example/bitbucket-cli', registry: 'https://npm.example.com/' },
            { via: 'brew', spec: 'bitbucket-cli' },
          ],
        },
      ],
    });
    const tool = toolchain.tools[0]!;
    expect(tool.setup?.map((s) => [s.id, s.title])).toEqual([
      ['token', 'Create a token on the intranet page'],
      ['login', 'Log in'],
    ]);
    expect(tool.install).toEqual([
      { via: 'npm', spec: '@example/bitbucket-cli', registry: 'https://npm.example.com/' },
      { via: 'brew', spec: 'bitbucket-cli' },
    ]);
  });

  it('replaces an unkeyed list as a whole', () => {
    const { toolchain } = mergeTools(base, {
      schema_version: 2,
      tools: [{ name: 'bitbucket-cli', version_args: ['version'] }],
    });
    expect(toolchain.tools[0]?.version_args).toEqual(['version']);
  });

  it('appends a tool the base does not know, with every field from the patch', () => {
    const { toolchain, provenance } = mergeTools(base, {
      schema_version: 2,
      tools: [{ name: 'worklog-cli', install: [{ via: 'npm', spec: '@example/worklog-cli' }] }],
    });
    expect(toolchain.tools.map((t) => t.name)).toEqual([
      'bitbucket-cli',
      'jira-cli',
      'worklog-cli',
    ]);
    expect(provenance['worklog-cli']?.['install']).toBe('patch');
  });

  it('merges defaults recursively', () => {
    const { toolchain } = mergeTools(base, {
      schema_version: 2,
      defaults: { npm_scope: '@example' },
      tools: [],
    });
    expect(toolchain.defaults).toMatchObject({
      npm_scope: '@example',
      version_args: ['--version'],
    });
  });
});

describe('loadTools', () => {
  const bundled = [
    'schema_version: 2',
    'min_cli: 0.1.0',
    'defaults: { install: [{ via: npm }], auth: { command: [auth, status] }, skill: { command: [skill, install], agent_flag: --agent } }',
    'tools:',
    '  - name: bitbucket-cli',
    '    docs: https://docs.example.com/bitbucket-cli',
    '  - name: jira-cli',
  ].join('\n');

  it('uses the bundled document alone when there is no patch', () => {
    const result = loadTools(bundled, undefined, cli);
    expect(result.problems).toEqual([]);
    expect(result.doc.tools.map((t) => t.name)).toEqual(['bitbucket-cli', 'jira-cli']);
    expect(result.provenance['jira-cli']?.['name']).toBe('base');
  });

  it('applies a patch with a null deletion and reports the merged result', () => {
    const patch = [
      'schema_version: 2',
      'tools:',
      '  - name: bitbucket-cli',
      '    docs: null',
      '    min_version: 1.2.3',
    ].join('\n');
    const result = loadTools(bundled, patch, cli);
    expect(result.doc.tools[0]).toEqual({ name: 'bitbucket-cli', min_version: '1.2.3' });
    expect(result.provenance['bitbucket-cli']?.['min_version']).toBe('patch');
  });

  it('carries null deletion semantics through defaults and nested fields', () => {
    const patch = [
      'schema_version: 2',
      'min_cli: null',
      'defaults:',
      '  auth: null',
      '  skill: { command: [skill, install], agent_flag: null }',
      'tools: [{ name: bitbucket-cli }]',
    ].join('\n');
    const result = loadTools(bundled, patch, cli);
    expect(result.doc).not.toHaveProperty('min_cli');
    expect(result.doc.defaults).not.toHaveProperty('auth');
    expect(result.doc.defaults?.skill).toEqual({ command: ['skill', 'install'] });
  });

  it('catches an entry the patch broke and drops it from the merged result', () => {
    const patch = ['schema_version: 2', 'tools:', '  - name: jira-cli', '    binary: bash'].join(
      '\n',
    );
    const result = loadTools(bundled, patch, cli);
    expect(result.dropped.map((d) => d.name)).toEqual(['jira-cli']);
    expect(result.doc.tools.map((t) => t.name)).toEqual(['bitbucket-cli']);
  });

  it('does not require a patch to be complete on its own', () => {
    const patch = [
      'schema_version: 2',
      'tools:',
      '  - name: only-here',
      '    desc: no install method of its own',
    ].join('\n');
    const result = loadTools(bundled, patch, cli);
    expect(result.problems).toEqual([]);
    expect(result.doc.tools.find((t) => t.name === 'only-here')).toBeDefined();
  });
});
