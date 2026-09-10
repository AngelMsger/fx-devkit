// Legibility rules for anything the manifest asks fx to execute. A binary
// is a plain name, never a path or an interpreter; an argument is a plain
// word or a plain flag. These keep a manifest readable at a glance; the
// security boundary is trust-on-first-use in the toolchain, not this file.

const PLAIN_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const PLAIN_FLAG = /^--?[A-Za-z][A-Za-z0-9-]*(?:=[A-Za-z0-9._@/:-]+)?$/;
const INTERPRETERS = new Set([
  'ash',
  'bash',
  'bun',
  'csh',
  'dash',
  'deno',
  'env',
  'eval',
  'fish',
  'ksh',
  'node',
  'nohup',
  'osascript',
  'perl',
  'php',
  'python',
  'python2',
  'python3',
  'ruby',
  'sh',
  'tclsh',
  'xargs',
  'zsh',
]);

export function binaryProblem(name: string): string | undefined {
  if (!PLAIN_NAME.test(name)) return 'must be a plain executable name without path or shell syntax';
  if (INTERPRETERS.has(name)) return `must not be an interpreter (${name})`;
  return undefined;
}

export function argumentProblem(arg: string): string | undefined {
  if (PLAIN_NAME.test(arg) || PLAIN_FLAG.test(arg)) return undefined;
  return `"${arg}" is not a plain word or flag`;
}
