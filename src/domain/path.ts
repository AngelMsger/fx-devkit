// Path containment, compared as resolved strings; symbolic links are the
// caller's business. A boundary (a workspace root, an imported directory)
// includes the directory itself. A stored relative path is judged by its text.

import path from 'node:path';

export function pathKey(value: string, paths: typeof path = path): string {
  const resolved = paths.resolve(value);
  return paths.sep === '\\' ? resolved.replace(/^\\\\\?\\/, '').toLowerCase() : resolved;
}

export function samePath(left: string, right: string): boolean {
  return pathKey(left) === pathKey(right);
}

export function windowsPathProblem(value: string): string | undefined {
  if (/^(?:\\\\|\/\/)/.test(value)) return 'Network workspace paths are not supported';
  const tail = value.slice(path.win32.parse(value).root.length);
  for (const part of tail.split(/[\\/]/).filter(Boolean)) {
    if (part === '.' || part === '..') continue;
    if (
      /[<>:"|?*\x00-\x1f]/.test(part) ||
      /[. ]$/.test(part) ||
      /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part)
    )
      return `Invalid Windows directory name: ${part}`;
  }
  return undefined;
}

export function isAtOrInside(child: string, parent: string): boolean {
  const relative = path.relative(path.resolve(parent), path.resolve(child));
  if (relative === '') return true;
  if (path.isAbsolute(relative)) return false;
  // A child named `..draft` is still a child; only a real parent step escapes.
  return relative !== '..' && !relative.startsWith(`..${path.sep}`);
}

// A slash-separated path naming an entry below its root on every platform: no empty,
// `.`, `..` or case-folded `.git` segment, no backslash, colon or control character.
export function isPlainRelativePath(value: string): boolean {
  return (
    !/[\\:\x00-\x1f\x7f]/u.test(value) &&
    value
      .split('/')
      .every(
        (part) => part !== '' && part !== '.' && part !== '..' && part.toLowerCase() !== '.git',
      )
  );
}
