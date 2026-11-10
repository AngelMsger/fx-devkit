// Invalid personal links must fail loading rather than become plausible ownership answers.
import { describe, expect, it } from 'vitest';
import { stringify } from 'yaml';

import { loadMembers } from '../../../../src/domain/manifest/loader.js';
import type { Person } from '../../../../src/domain/manifest/types.js';

function load(people: Person[], version = 1) {
  return loadMembers(
    stringify({ schema_version: version, min_cli: '0.16.0', sensitive: true, people }),
    { cliVersion: '0.0.0', strict: true },
  ).doc;
}

const people: Person[] = [
  { id: 'learner', mentor: 'guide', leader: 'owner' },
  { id: 'guide', leader: 'owner' },
  { id: 'owner' },
];

describe('personal relationships', () => {
  it.each([1, 2])(
    'reads shared accountability without inventing business areas in schema %i',
    (version) => {
      expect(load(people, version)).toMatchObject({ people });
    },
  );

  it.each(['mentor', 'leader'] as const)(
    'rejects unknown, collective, self and cyclic %s references',
    (field) => {
      for (const target of ['missing', 'all', 'learner', '']) {
        expect(() => load([{ ...people[0]!, [field]: target }, ...people.slice(1)])).toThrow();
      }
      const cycle = people.map((person, index) => ({
        ...person,
        [field]: people[(index + 1) % people.length]!.id,
      }));
      expect(() => load(cycle)).toThrow(/cycle/);
    },
  );
});
