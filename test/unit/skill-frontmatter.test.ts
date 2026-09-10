import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { parseFrontmatter } from '../../src/domain/skills/frontmatter.js';

describe('skills/fx-workspace/SKILL.md', () => {
  const text = readFileSync(path.resolve('skills/fx-workspace/SKILL.md'), 'utf8');
  const front = parseFrontmatter(text);
  const pkg = JSON.parse(readFileSync(path.resolve('package.json'), 'utf8')) as { version: string };

  it('carries the package version, so installed copies can be told from stale ones', () => {
    expect(front.name).toBe('fx-workspace');
    expect(front.version).toBe(pkg.version);
  });

  it('has a trigger-style description within the platform limit', () => {
    expect(front.description?.length ?? 0).toBeGreaterThan(50);
    expect(front.description?.length ?? 0).toBeLessThanOrEqual(1024);
    for (const word of ['workspace', 'manifest', 'sync', 'tool', 'agent', 'Skill']) {
      expect(front.description).toContain(word);
    }
    expect(front.description).toMatch(/^Use only when /);
    expect(front.description).toContain('Do not use for generic');
    expect(front.description).toContain('outside an fx-managed workspace');
  });

  it('routes the error codes requiring a recovery or authorization decision', () => {
    for (const code of ['READONLY_BLOCKED', 'VECTOR_UNTRUSTED', 'INPUT_REQUIRED', 'LOGIN_REQUIRED'])
      expect(text).toContain(code);
  });

  it('is the agent entry: the capability routing table, the handshake, and the fact rules', () => {
    // Routing is by capability: the Skill ships with the CLI and must not
    // assume what one manifest happens to call its platforms.
    for (const capability of ['error-tracker', 'log-store', 'ci', 'cluster'])
      expect(text).toContain(`| \`${capability}\``);
    expect(text).not.toMatch(/--platform (sentry|openobserve|jenkins|kube)\b/);
    expect(text).toContain('fx can code-host');
    expect(text).toContain('fx can <capability> --env <env>');
    expect(text).toContain('FX_SKILL_LOADED=1');
    expect(text).toContain('fx member show');
    expect(text).toContain('fx repo show <repo>');
    for (const word of ['logs', 'errors', 'builds', 'owners', 'Sentry', 'OpenObserve'])
      expect(front.description).toContain(word);
  });
});
