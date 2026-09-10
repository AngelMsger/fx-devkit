import { describe, expect, it } from 'vitest';

import { fx, packageName } from './harness.js';

describe('fx --version and self info', () => {
  it('answers --version and -v with the oclif line, and has no version command', () => {
    for (const flag of ['--version', '-v']) {
      const run = fx([flag]);
      expect(run.status, run.stderr).toBe(0);
      expect(run.stdout.startsWith(`${packageName}/`)).toBe(true);
      expect(run.stdout.slice(packageName.length + 1)).toMatch(/^\d+\.\d+\.\d+ /);
    }
    expect(fx(['version']).status).toBe(2);
  });

  it('carries the version and runtime in self info, honouring FX_FORMAT under the flag', () => {
    const info = fx(['self', 'info', '--format', 'json']);
    expect(info.status).toBe(0);
    expect(info.json()).toMatchObject({ name: packageName, version: expect.any(String) });
    expect((info.json() as { runtime: string }).runtime).toMatch(/^node /);
    expect(() => fx(['self', 'info'], { FX_FORMAT: 'json' }).json()).not.toThrow();
    expect(fx(['self', 'info', '--format', 'human'], { FX_FORMAT: 'json' }).stdout).toMatch(
      new RegExp(`^name\\s+${packageName}`),
    );
  });

  it('rejects an unknown flag as a usage error with the family code', () => {
    const run = fx(['self', 'info', '--nope']);
    expect(run.status).toBe(2);
    expect(run.stdout).toBe('');
    expect(run.error()).toMatchObject({ category: 'usage', code: 'BAD_FLAG' });
    expect(run.error().next_steps).toContain('fx self info --help');
  });

  it('documents agent usage in its help', () => {
    const run = fx(['self', 'info', '--help']);
    expect(run.status).toBe(0);
    expect(run.stdout).toContain('AGENT USAGE');
    expect(run.stdout).toContain('--format json');
  });
});
