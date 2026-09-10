import { describe, expect, it } from 'vitest';

import { parseFields, project } from '../../../src/cli/render/fields.js';

describe('project', () => {
  it('keeps only the requested dot paths, using the full path as the output key', () => {
    const value = {
      name: 'fx-example-api',
      obs: { svc: 'example-api', covered: true },
      tags: ['a'],
    };
    expect(project(value, ['name', 'obs.svc'])).toEqual({
      name: 'fx-example-api',
      'obs.svc': 'example-api',
    });
  });

  it('projects each item of a list and omits paths that do not resolve', () => {
    expect(project([{ a: 1, b: 2 }, { a: 3 }], ['a', 'zz'])).toEqual([{ a: 1 }, { a: 3 }]);
  });

  it('passes scalars through untouched', () => {
    expect(project('x', ['a'])).toBe('x');
  });

  it('projects fields through report arrays without losing item alignment', () => {
    const report = {
      findings: [
        { group: 'deps', level: 'ok' },
        { group: 'ci', level: 'fail', fix: 'rebuild' },
      ],
    };
    expect(project(report, ['findings.group', 'findings.level', 'findings.fix'])).toEqual({
      'findings.group': ['deps', 'ci'],
      'findings.level': ['ok', 'fail'],
      'findings.fix': [null, 'rebuild'],
    });
    expect(project({ findings: [] }, ['findings.group'])).toEqual({ 'findings.group': [] });
  });
});

describe('parseFields', () => {
  it('splits on commas, trims, and treats an empty flag as no projection', () => {
    expect(parseFields(' name, obs.svc ')).toEqual(['name', 'obs.svc']);
    expect(parseFields(undefined)).toBeUndefined();
    expect(parseFields('')).toBeUndefined();
  });
});
