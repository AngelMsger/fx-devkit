// Probe evidence has a coordinate identity and the narrowest scope its inputs
// require. Unused variables cannot broaden or narrow the probe's own evidence.

import { createHash } from 'node:crypto';

import { placeholders, type Vars } from '../template.js';

interface ProbeScopeInput {
  readonly template: readonly string[];
  readonly vars: Vars;
  readonly hasRepoOverride: boolean;
}

export function probeScope(input: ProbeScopeInput): 'environment' | 'repository' {
  if (input.hasRepoOverride) return 'repository';
  const dependsOnRepo = (key: string, seen: ReadonlySet<string>): boolean => {
    if (seen.has(key)) return false;
    const value = input.vars[key];
    if (value === undefined) return key === 'repo' || key === 'svc';
    const next = new Set([...seen, key]);
    return placeholders(value).some((child) => dependsOnRepo(child, next));
  };
  return input.template.flatMap(placeholders).some((key) => dependsOnRepo(key, new Set()))
    ? 'repository'
    : 'environment';
}

export function coordinateFingerprint(input: {
  readonly provider: string | null;
  readonly vars: Vars;
}): string {
  const vars = Object.keys(input.vars)
    .sort()
    .map((key) => [key, input.vars[key]]);
  return createHash('sha256')
    .update(JSON.stringify({ provider: input.provider, vars }))
    .digest('hex');
}
