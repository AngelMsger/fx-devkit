import { describe, expect, it } from 'vitest';

import { fx } from './harness.js';

describe('runtime registry coordinates', () => {
  it('uses FX_REGISTRY for a self-update preview without an embedded package address', () => {
    const result = fx(['self', 'update', '--dry-run', '--format', 'json'], {
      FX_REGISTRY: 'https://npm.example.com/',
    });
    expect(result.status, result.stderr).toBe(0);
    expect(result.json()).toMatchObject({
      ran: false,
      vector: [
        'npm',
        'install',
        '-g',
        '@fx/devkit@latest',
        '--registry',
        'https://npm.example.com/',
        '--@fx:registry=https://npm.example.com/',
      ],
    });
  });
  it('does not infer a public target when the coordinate is absent or unsafe', () => {
    for (const FX_REGISTRY of ['', 'https://registry.npmjs.org/']) {
      const result = fx(['self', 'update', '--dry-run', '--format', 'json'], { FX_REGISTRY });
      expect(result.error().code).toBe('REGISTRY_UNKNOWN');
      expect(result.stdout).toBe('');
    }
  });
});
