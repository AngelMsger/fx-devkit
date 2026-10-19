import { describe, expect, it } from 'vitest';

import {
  matchesRegistry,
  OPERATION_ACTIONS,
  OPERATION_PHASES,
  parseJournal,
  sameEntry,
  serializeJournal,
  type OperationAction,
  type OperationJournal,
  type OperationPhase,
} from '../../../../src/domain/workspace/operation-journal.js';

const before = { root: '/ws/alpha', source: 'https://git.example.com/team/manifest.git' };
const changes: Record<OperationAction, Pick<OperationJournal, 'after' | 'root'>> = {
  unregister: { after: null, root: '/ws/alpha' },
  relocate: { after: { ...before, root: '/ws/moved' }, root: '/ws/moved' },
  rebind: { after: { ...before, source: '/srv/manifest' }, root: '/ws/alpha' },
};

function journal(action: OperationAction, phase: OperationPhase = 'planned'): OperationJournal {
  return {
    id: '00000000-0000-4000-8000-000000000001',
    name: 'alpha',
    action,
    before,
    ...changes[action],
    phase,
  };
}

const everyActionAtEveryPhase = OPERATION_ACTIONS.flatMap((action) =>
  OPERATION_PHASES.map((phase) => [action, phase] as const),
);
const mismatchedChanges = OPERATION_ACTIONS.flatMap((action) =>
  OPERATION_ACTIONS.filter((other) => other !== action).map((other) => [action, other] as const),
);

describe('operation journal file', () => {
  it('keeps the field order an interrupted operation of another fx version left on disk', () => {
    expect(serializeJournal(journal('unregister', 'resources_cleaned'))).toBe(
      '{"id":"00000000-0000-4000-8000-000000000001","name":"alpha","action":"unregister",' +
        '"before":{"root":"/ws/alpha","source":"https://git.example.com/team/manifest.git"},' +
        '"after":null,"root":"/ws/alpha","phase":"resources_cleaned"}',
    );
  });

  it.each(everyActionAtEveryPhase)('resumes a %s recorded at %s', (action, phase) => {
    const recorded = journal(action, phase);
    expect(parseJournal(serializeJournal(recorded), 'alpha')).toEqual(recorded);
  });

  it.each(mismatchedChanges)(
    'refuses a %s that records the registry change of a %s',
    (action, other) => {
      const recorded = { ...journal(action), ...changes[other] };
      expect(parseJournal(JSON.stringify(recorded), 'alpha')).toBeUndefined();
    },
  );

  it.each([
    ['is not JSON', '{'],
    ['is not an object', 'null'],
    ['belongs to another workspace', JSON.stringify({ ...journal('rebind'), name: 'beta' })],
    ['has a foreign id', JSON.stringify({ ...journal('rebind'), id: '../alpha' })],
    ['names an unknown action', JSON.stringify({ ...journal('rebind'), action: 'rename' })],
    ['names an unknown phase', JSON.stringify({ ...journal('rebind'), phase: 'done' })],
    ['lacks the acted-on root', JSON.stringify({ ...journal('rebind'), root: undefined })],
    [
      'records an entry with a field the registry never holds',
      JSON.stringify({ ...journal('rebind'), before: { ...before, token: 'x' } }),
    ],
  ])('refuses a file that %s', (_reason, text) => {
    expect(parseJournal(text, 'alpha')).toBeUndefined();
  });
});

describe('matchesRegistry', () => {
  const rebind = changes.rebind.after;

  it.each([
    ['planned', true, false],
    ['source_ready', true, false],
    ['resources_cleaned', true, true],
    ['source_replaced', true, true],
    ['registered', false, true],
  ] as const)(
    'at %s accepts the old entry: %s, the new entry: %s',
    (phase, acceptsOld, acceptsNew) => {
      expect(matchesRegistry(journal('rebind', phase), before)).toBe(acceptsOld);
      expect(matchesRegistry(journal('rebind', phase), rebind)).toBe(acceptsNew);
    },
  );

  it('never accepts a registration the operation did not plan', () => {
    const other = { ...before, source: '/srv/other' };
    for (const phase of OPERATION_PHASES) {
      expect(matchesRegistry(journal('rebind', phase), other)).toBe(false);
      expect(matchesRegistry(journal('rebind', phase), null)).toBe(false);
    }
  });

  it('expects the registration to be gone once an unregister is recorded', () => {
    expect(matchesRegistry(journal('unregister', 'registered'), null)).toBe(true);
    expect(matchesRegistry(journal('unregister', 'registered'), before)).toBe(false);
    expect(matchesRegistry(journal('unregister', 'planned'), null)).toBe(false);
  });
});

describe('sameEntry', () => {
  it('compares the registration rather than how its object was built', () => {
    expect(sameEntry({ source: '/s', root: '/r' }, { root: '/r', source: '/s' })).toBe(true);
    expect(sameEntry({ root: '/r' }, { root: '/r', source: '/s' })).toBe(false);
    expect(sameEntry(null, null)).toBe(true);
    expect(sameEntry(null, { root: '/r' })).toBe(false);
  });
});
