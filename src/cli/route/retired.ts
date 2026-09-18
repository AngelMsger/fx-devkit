// Retired command spellings, and how the rest of the line is rewritten into what
// answers the same intent now. The rest is read as flags and words first, so a
// flag keeps its value, a boolean keeps nothing, and a fixed replacement keeps
// the global flags (--dry-run above all) and drops the obsolete ones.
//
// This table is meant to be deleted whole one day; routing calls it once.

import { GLOBAL_FLAGS, VALUE_FLAGS } from './tokens.js';

interface Token {
  readonly flag?: string;
  readonly value?: string;
  readonly word?: string;
}
type Rewrite = (rest: readonly Token[]) => string[];

// Flags of the retired commands that took a value, on top of the global ones.
const OLD_VALUE_FLAGS = new Set([
  ...VALUE_FLAGS,
  '--env',
  '--repo',
  '--platform',
  '--agent',
  '--dir',
  '--out',
  '-o',
  '--jobs',
  '--tool',
  '--name',
  '--from',
  '--kind',
  '--only',
]);
const KEPT_BY_FIXED = new Set([...GLOBAL_FLAGS, '--dry-run']);

export interface RetiredCommand {
  readonly name: string;
  readonly replacement: readonly string[];
}

// The retired spelling the line starts with, and the commands that replace it.
export function retiredCommand(
  words: readonly string[],
  argv: readonly string[],
): RetiredCommand | undefined {
  const two = `${words[0] ?? ''} ${words[1] ?? ''}`;
  const name = two in RETIRED ? two : (words[0] ?? '');
  const rewrite = RETIRED[name];
  if (rewrite === undefined) return undefined;
  return { name, replacement: rewrite(tokenize(withoutWords(argv, name))) };
}

function tokenize(rest: readonly string[]): Token[] {
  const out: Token[] = [];
  for (let i = 0; i < rest.length; i++) {
    const token = rest[i] ?? '';
    if (!token.startsWith('-')) {
      out.push({ word: token });
      continue;
    }
    const eq = token.indexOf('=');
    if (eq !== -1) out.push({ flag: token.slice(0, eq), value: token.slice(eq + 1) });
    else if (OLD_VALUE_FLAGS.has(token)) {
      const value = rest[++i];
      out.push(value === undefined ? { flag: token } : { flag: token, value });
    } else out.push({ flag: token });
  }
  return out;
}

function render(tokens: readonly Token[]): string[] {
  return tokens.flatMap((t) => {
    if (t.word !== undefined) return [t.word];
    return t.value === undefined ? [t.flag ?? ''] : [t.flag ?? '', t.value];
  });
}

const join = (...parts: readonly string[]): string => parts.filter((p) => p !== '').join(' ');
const renamed =
  (to: string): Rewrite =>
  (rest) => [join(to, ...render(rest))];
const fixed =
  (...to: string[]): Rewrite =>
  (rest) => {
    const globals = render(rest.filter((t) => t.flag !== undefined && KEPT_BY_FIXED.has(t.flag)));
    return to.map((command) => join(command, ...globals));
  };
const bare =
  (to: string): Rewrite =>
  () => [to];
const withoutFlag = (rest: readonly Token[], flag: string): Token[] =>
  rest.filter((t) => t.flag !== flag);

const RETIRED: Readonly<Record<string, Rewrite>> = {
  bootstrap: renamed('init'),
  setup: renamed('login'),
  need: rewriteNeed,
  import: renamed('manifest import'),
  'obs where': renamed('where'),
  'obs probe': (rest) => [join('where', ...render(rest), '--probe')],
  'docs render': (rest) => [
    join('manifest render', ...render(rest)),
    ...fixed('sync --only docs')(rest),
  ],
  'profile export': renamed('config export'),
  'profile import': renamed('config import'),
  'skill sync': fixed('sync --only skills'),
  'skill install': fixed('sync --only skills'),
  'tool check': (rest) => [
    join(
      'doctor',
      ...render(rest.map((t) => (t.word === undefined ? t : { flag: '--tool', value: t.word }))),
    ),
  ],
  'tool explain': renamed('tool show'),
  'agent detect': fixed('agent list'),
  'agent enable': renamed('agent pick'),
  'agent disable': renamed('agent unpick'),
  'member who': renamed('member show'),
  'member owners': renamed('repo show'),
  'config path': fixed('self info'),
  version: bare('--version'),
  'self version': bare('--version'),
};

// `need <target> --env e --repo r` asked two things at once: the repository's
// row of `where`, and `can` for the target.
function rewriteNeed(rest: readonly Token[]): string[] {
  const repo = rest.find((t) => t.flag === '--repo')?.value;
  const kept = withoutFlag(rest, '--repo');
  const can = join('can', ...render(kept));
  if (repo === undefined) return [can];
  const target = kept.findIndex((t) => t.word !== undefined);
  return [join('where', repo, ...render(kept.filter((_, i) => i !== target))), can];
}

function withoutWords(argv: readonly string[], name: string): string[] {
  const pending = name.split(' ');
  return argv.filter((token) => {
    if (token === pending[0]) {
      pending.shift();
      return false;
    }
    return true;
  });
}
