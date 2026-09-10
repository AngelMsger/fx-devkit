import { describe, expect, it } from 'vitest';

import type { Members } from '../../../../src/domain/manifest/types.js';
import { findByGitName, findPeople } from '../../../../src/domain/members/resolve.js';

const members: Members = {
  schema_version: 1,
  sensitive: true,
  people: [
    { id: 'alice', display: 'Alice-张三', git_names: ['Alice'] },
    { id: 'al', display: 'Al-李四', git_names: ['al-l'] },
    { id: 'bo', display: 'Bo', git_names: ['Bo'] },
    { id: 'bob', display: 'Bob', git_names: ['Bo'] },
  ],
};

describe('findByGitName', () => {
  it('matches a git name or a display name exactly, ignoring case', () => {
    expect(findByGitName(members, 'alice')?.id).toBe('alice');
    expect(findByGitName(members, 'AL-李四')?.id).toBe('al');
  });

  it('never matches by substring or by spelling distance, unlike findPeople', () => {
    expect(findByGitName(members, 'Al')).toBeUndefined();
    expect(findByGitName(members, 'Alise')).toBeUndefined();
    expect(findPeople(members, 'Al').map((m) => m.person.id)).toContain('alice');
  });

  it('answers nobody when two people share the name', () => {
    expect(findByGitName(members, 'Bo')).toBeUndefined();
  });
});
