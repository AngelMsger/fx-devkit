import { describe, expect, it } from 'vitest';

import { placeholders, substitute, substituteAll } from '../../../src/domain/template.js';

describe('substitute', () => {
  it('fills what it has and reports what it lacks, leaving the placeholder visible', () => {
    expect(substitute('{a}-{b}-{a}', { a: 'x' })).toEqual({ text: 'x-{b}-x', missing: ['b'] });
    expect(substituteAll(['--ctx', '{setup.source}', '{env}'], { env: 'test' })).toEqual({
      vector: ['--ctx', '{setup.source}', 'test'],
      missing: ['setup.source'],
    });
  });

  it('lists placeholders in a template', () => {
    expect(placeholders('{web}/x/{web}/{a.b}')).toEqual(['web', 'web', 'a.b']);
  });
});
