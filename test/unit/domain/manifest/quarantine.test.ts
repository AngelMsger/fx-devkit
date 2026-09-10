import { describe, expect, it } from 'vitest';

import { partitionProblems } from '../../../../src/domain/manifest/quarantine.js';

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
