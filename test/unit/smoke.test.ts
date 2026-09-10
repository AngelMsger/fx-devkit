import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

describe('runtime', () => {
  it('meets the Node major declared by the package', () => {
    const packageJson = JSON.parse(readFileSync('package.json', 'utf8')) as {
      engines: { node: string };
    };
    const required = Number(/^>=(\d+)$/.exec(packageJson.engines.node)?.[1]);
    const running = Number(process.versions.node.split('.')[0]);
    expect(required).toBeGreaterThan(0);
    expect(running).toBeGreaterThanOrEqual(required);
  });
});
