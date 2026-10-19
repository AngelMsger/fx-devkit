import { describe, expect, it } from 'vitest';

import {
  droppedEntry,
  droppedEntryOf,
  mapEntryIndex,
  partitionProblems,
} from '../../../../src/domain/manifest/quarantine.js';

describe('partitionProblems', () => {
  it('assigns problems under repos[i] to that entry and everything else to the document', () => {
    const { entries, document } = partitionProblems(
      [
        { path: 'repos[1].name', message: 'required' },
        { path: 'repos[1].path', message: 'absolute' },
        { path: 'repos[4].branch', message: 'missing' },
        { path: 'defaults.host', message: 'required' },
        { path: 'repos', message: 'empty' },
        { path: 'schema_version', message: 'required' },
      ],
      'repos',
    );
    expect([...entries.keys()]).toEqual([1, 4]);
    expect(entries.get(1)?.map((p) => p.message)).toEqual(['required', 'absolute']);
    expect(document.map((p) => p.path)).toEqual(['defaults.host', 'repos', 'schema_version']);
  });

  it('does not treat another collection as entries', () => {
    const { entries, document } = partitionProblems(
      [{ path: 'tools[0].name', message: 'x' }],
      'repos',
    );
    expect(entries.size).toBe(0);
    expect(document).toHaveLength(1);
  });
});

describe('dropped entries', () => {
  it('ties a problem back to the entry it dropped, and a document problem to none', () => {
    const missing = { path: 'tools[1].install', message: 'required' };
    const unnamed = { path: 'tools[1].name', message: 'empty' };
    const dropped = [
      droppedEntry('tools', 'alpha', [missing, unnamed]),
      droppedEntry('tools', 'tools[3]', [{ path: 'tools[3].install', message: 'required' }]),
    ];
    expect(droppedEntryOf(unnamed, dropped)?.name).toBe('alpha');
    expect(droppedEntryOf({ path: 'tools[3].install', message: 'required' }, dropped)?.name).toBe(
      'tools[3]',
    );
    expect(
      droppedEntryOf({ path: 'defaults.install', message: 'required' }, dropped),
    ).toBeUndefined();
  });

  it('rewrites the index of its own collection and leaves every other path alone', () => {
    const kept = [2, 5];
    const original = (index: number): number => kept[index] ?? index;
    expect(mapEntryIndex('repos[1].branch', 'repos', original)).toBe('repos[5].branch');
    expect(mapEntryIndex('repos[1].branch', 'repos', () => '')).toBe('repos[].branch');
    expect(mapEntryIndex('tools[1].name', 'repos', original)).toBe('tools[1].name');
    expect(mapEntryIndex('defaults.repos[1]', 'repos', original)).toBe('defaults.repos[1]');
  });
});
