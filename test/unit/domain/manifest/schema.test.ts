import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

import { environmentsSchema } from '../../../../src/domain/manifest/environments.schema.js';
import { localSchema } from '../../../../src/domain/manifest/local.schema.js';
import { membersSchema } from '../../../../src/domain/manifest/members.schema.js';
import { undescribedFields } from '../../../../src/domain/manifest/reflect.js';
import { toolsSchema } from '../../../../src/domain/manifest/tools.schema.js';
import { workspaceSchema } from '../../../../src/domain/manifest/workspace.schema.js';

const fixture = (name: string): unknown =>
  parse(readFileSync(path.resolve('test/fixtures/manifest', name), 'utf8'));

describe('workspace schema', () => {
  it('accepts a schema 1 document with the host under defaults and no providers', () => {
    const result = workspaceSchema.safeParse(fixture('v1-minimal/workspace.yaml'));
    expect(result.success).toBe(true);
  });

  it('accepts the real-world schema 1 shape: platform-first overrides, reserved workflows', () => {
    const result = workspaceSchema.safeParse(fixture('v1-real-shape/workspace.yaml'));
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.repos[1]?.obs?.overrides?.['sentry']?.['prod']?.confidence).toBe('verified');
  });

  it('accepts a schema 2 document with providers', () => {
    const result = workspaceSchema.safeParse(fixture('v2-full/workspace.yaml'));
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.providers?.['code-host']?.provider).toBe('bitbucket-cli');
  });

  it('rejects an unknown confidence value', () => {
    const doc = fixture('v1-minimal/workspace.yaml') as { repos: { obs?: unknown }[] };
    doc.repos[1]!.obs = { overrides: { jenkins: { test: { confidence: 'maybe' } } } };
    expect(workspaceSchema.safeParse(doc).success).toBe(false);
  });
});

describe('environments schema', () => {
  it('accepts schema 1 and schema 2 documents', () => {
    expect(environmentsSchema.safeParse(fixture('v1-real-shape/environments.yaml')).success).toBe(
      true,
    );
    const v2 = environmentsSchema.safeParse(fixture('v2-full/environments.yaml'));
    expect(v2.success).toBe(true);
    if (!v2.success) return;
    expect(v2.data.platforms['sentry']?.capability).toBe('error-tracker');
    expect(v2.data.envs['test']?.platforms?.['kube']?.setup?.['source']).toContain('example.com');
  });
});

describe('tools schema', () => {
  it('accepts a team patch with a manual setup step and a disabled tool', () => {
    const result = toolsSchema.safeParse(fixture('v2-full/tools.yaml'));
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.tools[2]?.enabled).toBe(false);
    expect(result.data.tools[0]?.setup?.[0]?.kind).toBe('manual');
  });

  it('rejects an installer outside npm/go/brew/manual', () => {
    const doc = { schema_version: 3, tools: [{ name: 'x', install: [{ via: 'curl' }] }] };
    expect(toolsSchema.safeParse(doc).success).toBe(false);
  });
});

describe('members schema', () => {
  it('accepts string and object account spellings', () => {
    expect(membersSchema.safeParse(fixture('v1-real-shape/members.yaml')).success).toBe(true);
    expect(membersSchema.safeParse(fixture('v2-full/members.yaml')).success).toBe(true);
  });

  it('refuses a document that is not marked sensitive', () => {
    expect(membersSchema.safeParse(fixture('broken/members-not-sensitive.yaml')).success).toBe(
      false,
    );
  });
});

describe('local schema', () => {
  it('accepts scope, local repos, path/branch overrides and setup acknowledgements', () => {
    expect(localSchema.safeParse(fixture('local/local.yaml')).success).toBe(true);
  });

  it('refuses an override that copies a shared field', () => {
    const result = localSchema.safeParse(fixture('local/leaks-shared-field.yaml'));
    expect(result.success).toBe(false);
  });
});

describe('every field is documented', () => {
  it.each([
    ['workspace', workspaceSchema],
    ['environments', environmentsSchema],
    ['tools', toolsSchema],
    ['members', membersSchema],
    ['local', localSchema],
  ])('%s has a description on every field', (_kind, schema) => {
    expect(undescribedFields(schema)).toEqual([]);
  });
});
