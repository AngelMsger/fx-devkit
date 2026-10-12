import { describe, expect, it } from 'vitest';

import type { Members } from '../../../../src/domain/manifest/types.js';
import { judgeMerge } from '../../../../src/domain/release/merge.js';
import type { Commit } from '../../../../src/ports/code-host.js';

const members: Members = {
  schema_version: 1,
  sensitive: true,
  people: [
    { id: 'alice', display: 'Alice-张三', git_names: ['Alice', 'alice-z'] },
    { id: 'bo', display: 'Bo-李四', git_names: ['Bo'] },
    { id: 'bob', display: 'Bob-王五', git_names: ['Bo'] },
  ],
};

const commit = (sha: string, author: string, message: string, parents = ['p']): Commit => ({
  sha,
  author,
  date: '2026-09-01T00:00:00Z',
  message,
  parents,
});

const base = { repo: 'a', source: 'dev', target: 'main', bots: ['jenkins ci'], members };

describe('judgeMerge', () => {
  it('passes when both directions are empty', () => {
    expect(judgeMerge({ ...base, ahead: { commits: [] }, behind: { commits: [] } })).toMatchObject({
      group: 'merge',
      id: 'a',
      level: 'ok',
      message: 'dev and main agree',
    });
  });

  it('fails on unreleased work, and on a hotfix nobody brought back', () => {
    const ahead = judgeMerge({
      ...base,
      ahead: { commits: [commit('1', 'Alice', 'feat: x')] },
      behind: { commits: [] },
    });
    expect(ahead).toMatchObject({ level: 'fail', message: '1 commit on dev not merged into main' });
    const behind = judgeMerge({
      ...base,
      ahead: { commits: [] },
      behind: { commits: [commit('2', 'Alice', 'fix: y'), commit('3', 'Alice', 'fix: z')] },
    });
    expect(behind).toMatchObject({
      level: 'fail',
      message: '2 commits on main not merged back into dev',
    });
  });

  it('ignores merge commits and bot commits but counts them as filtered', () => {
    const out = judgeMerge({
      ...base,
      ahead: {
        commits: [
          commit('m', 'Alice', 'Merge pull request #1 in X from a to dev', ['p1', 'p2']),
          commit('b', 'jenkins ci', 'bugfix: v1.2.3'),
          commit('s', 'Alice', 'Merge branch main into dev'),
        ],
      },
      behind: { commits: [] },
    });
    expect(out.level).toBe('ok');
    expect(out.evidence).toMatchObject({ ahead: [], behind: [], filtered: 3 });
  });

  it('attributes authors through members exactly, keeps unknown names, and refuses ambiguity', () => {
    const out = judgeMerge({
      ...base,
      ahead: {
        commits: [
          commit('1', 'alice-z', 'a'),
          commit('2', 'Bo', 'b'),
          commit('3', 'Al', 'c'),
          commit('4', 'Someone Else', 'd'),
        ],
      },
      behind: { commits: [] },
    });
    expect((out.evidence?.['ahead'] as { author: unknown }[]).map((c) => c.author)).toEqual([
      { id: 'alice', name: 'Alice-张三' },
      { id: null, name: 'Bo' },
      { id: null, name: 'Al' },
      { id: null, name: 'Someone Else' },
    ]);
  });

  it('keeps what one direction saw when the other could not be compared', () => {
    const blind = judgeMerge({
      ...base,
      ahead: { commits: [commit('1', 'Alice', 'feat: x')] },
      behind: { commits: undefined, reason: 'bitbucket-cli could not compare dev..main' },
    });
    expect(blind).toMatchObject({ level: 'fail', coverage: 'incomplete' });
    expect(blind.message).toContain('1 commit on dev not merged into main');
    expect(blind.message).toContain('could not compare dev..main');
    expect(blind.evidence).toMatchObject({ unknown: ['dev..main'] });

    const both = judgeMerge({
      ...base,
      ahead: { commits: [], reason: undefined },
      behind: { commits: undefined, reason: 'timed out' },
    });
    expect(both).toMatchObject({
      level: 'warn',
      message: 'could not compare dev..main: timed out',
      coverage: 'incomplete',
    });
  });

  it('works without a members document', () => {
    const out = judgeMerge({
      ...base,
      members: undefined,
      ahead: { commits: [commit('1', 'Alice', 'a')] },
      behind: { commits: [] },
    });
    expect(out.evidence).toMatchObject({ ahead: [{ author: { id: null, name: 'Alice' } }] });
  });
});
