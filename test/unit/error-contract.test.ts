// Source code may throw only DevkitError, so every failure that reaches a
// boundary retains the category, stable code and recovery contract.

import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

function filesAt(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const at = path.join(dir, entry.name);
    if (entry.isDirectory()) return filesAt(at);
    return entry.isFile() && at.endsWith('.ts') ? [at] : [];
  });
}

describe('the error boundary contract', () => {
  it('has no source path that throws a bare Error', () => {
    const violations = filesAt(path.resolve('src')).flatMap((file) =>
      readFileSync(file, 'utf8').includes('throw new Error') ? [path.relative('.', file)] : [],
    );
    expect(violations).toEqual([]);
  });
});
