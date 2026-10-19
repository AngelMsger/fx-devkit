import path from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  isAtOrInside,
  isPlainRelativePath,
  pathKey,
  windowsPathProblem,
} from '../../../src/domain/path.js';

describe('isAtOrInside', () => {
  it('tells a child, the directory itself, a sibling and a parent step apart', () => {
    expect(isAtOrInside('/ws/fx', '/ws/fx')).toBe(true);
    expect(isAtOrInside('/ws/fx/src', '/ws/fx')).toBe(true);
    expect(isAtOrInside('/ws/fx/..draft/out.yaml', '/ws/fx')).toBe(true);
    expect(isAtOrInside('/ws/fxtra', '/ws/fx')).toBe(false);
    expect(isAtOrInside('/ws', '/ws/fx')).toBe(false);
    expect(isAtOrInside('/ws/fx/../other', '/ws/fx')).toBe(false);
    expect(isAtOrInside(path.resolve('/elsewhere'), '/ws/fx')).toBe(false);
  });
});

describe('isPlainRelativePath', () => {
  it.each(['a.md', 'docs/guide/a.md', '.mcp.json', '.github/workflows/ci.yml', '..draft/a.md'])(
    'accepts %j',
    (value) => {
      expect(isPlainRelativePath(value)).toBe(true);
    },
  );

  it.each([
    '',
    '/etc/passwd',
    'docs//a.md',
    'docs/',
    './a.md',
    'docs/./a.md',
    '../a.md',
    'docs/..',
    '.git/config',
    'vendor/.GIT/config',
    'docs\\a.md',
    'C:/a.md',
    'a\nb.md',
    'a\x7fb.md',
  ])('refuses %j', (value) => {
    expect(isPlainRelativePath(value)).toBe(false);
  });
});

describe('pathKey', () => {
  it('folds case and separators on Windows and keeps POSIX case', () => {
    expect(pathKey('C:\\Work\\Repo', path.win32)).toBe(pathKey('c:/work/repo', path.win32));
    expect(pathKey('/Work', path.posix)).not.toBe(pathKey('/work', path.posix));
  });
});

describe('windowsPathProblem', () => {
  it.each([
    ['C:\\a\\CON.txt', 'CON.txt'],
    ['C:\\a\\tail.', 'tail.'],
    ['C:\\a\\tail ', 'tail '],
  ])('names the directory Windows cannot hold in %j', (value, name) => {
    expect(windowsPathProblem(value)).toBe(`Invalid Windows directory name: ${name}`);
  });

  it('refuses a network path whatever its names are', () => {
    expect(windowsPathProblem('\\\\server\\share\\a')).toBe(
      'Network workspace paths are not supported',
    );
  });

  it('accepts a drive path with spaces and names outside ASCII', () => {
    expect(windowsPathProblem('D:\\中文 workspace\\repo')).toBeUndefined();
  });
});
