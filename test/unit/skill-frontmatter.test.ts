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

  it('has a discoverable description within the host limit', () => {
    expect(front.description?.trim().length ?? 0).toBeGreaterThan(0);
    expect(front.description?.length ?? 0).toBeLessThanOrEqual(1024);
  });
});
