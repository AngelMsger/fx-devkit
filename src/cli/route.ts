// Decides, before oclif sees the argv, whether it names a real command. Left alone,
// oclif answers an unknown child of a topic with the topic's help and exit 0, treats a
// leading flag as the command name, and lets a bad --format value hide behind bare-topic
// help — each a success answer to a broken invocation. This router turns all of them
// into usage errors before oclif runs.

import { nearest } from '../domain/fuzzy.js';

import { globalFlags } from './flags.js';

export type Route =
  | { readonly kind: 'run' }
  | {
      readonly kind: 'unknown';
      readonly attempted: string;
      readonly nearest?: string;
      readonly replacement?: readonly string[];
      readonly help: string;
    }
  | { readonly kind: 'misplaced-flag'; readonly flag: string }
  | { readonly kind: 'bad-flag-value'; readonly flag: string; readonly value?: string }
  | { readonly kind: 'stray-flag'; readonly topic: string; readonly flag: string };

export function normalizeArgv(argv: readonly string[], commandIds: readonly string[]): string[] {
  const globals: string[] = [];
  const words: string[] = [];
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i] ?? '';
    const taken = globalAt(argv, i);
    if (taken !== undefined) {
      globals.push(...taken.tokens);
      i = taken.last;
      continue;
    }
    if (token === '--' || token.startsWith('-')) return [...argv];
    words.push(token);
    const attempted = words.join(' ');
    if (commandIds.includes(attempted)) return [...words, ...globals, ...argv.slice(i + 1)];
    if (!commandIds.some((id) => id.startsWith(`${attempted} `)))
      return globals.length === 0 ? [...argv] : [...words, ...globals, ...argv.slice(i + 1)];
  }
  return [...argv];
}

export function routeArgv(
  argv: readonly string[],
  commandIds: readonly string[],
  options: { readonly discoverableIds?: readonly string[] } = {},
): Route {
  const discoverableIds = options.discoverableIds ?? commandIds;
  const scan = scanArgv(argv);
  if (scan.leadingFlag !== undefined) return { kind: 'misplaced-flag', flag: scan.leadingFlag };
  if (scan.badValue !== undefined) return { kind: 'bad-flag-value', ...scan.badValue };
  const { words, afterTerminator } = scan;
  if (words.length === 0) {
    if (afterTerminator === undefined) return { kind: 'run' };
    return unknown(afterTerminator, discoverableIds, '--help');
  }
  if (words[0]?.includes(' ')) return unknown(words[0], discoverableIds, '--help');
  if (hasCommandPrefix(words, commandIds)) return { kind: 'run' };

  const topic = words[0] ?? '';
  const name = retiredName(words);
  const rewrite = RETIRED[name];
  if (rewrite !== undefined)
    return unknown(name, discoverableIds, '--help', rewrite(tokenize(withoutWords(argv, name))));
  const children = discoverableIds.filter((id) => id.startsWith(`${topic} `));
  if (children.length === 0) return unknown(topic, discoverableIds, '--help');
  // `fx self -- bogus` names no subcommand either, and `fx self --bogus` asks
  // a topic to parse a flag no global owns; topics do not parse.
  const stray = words[1] ?? afterTerminator;
  if (stray !== undefined) return unknown(`${topic} ${stray}`, children, `${topic} --help`);
  if (scan.strayFlag !== undefined) return { kind: 'stray-flag', topic, flag: scan.strayFlag };
  return { kind: 'run' };
}

// Flags oclif itself answers when nothing else is on the line.
const PRE_OK = new Set(['-h', '--help', '-v', '--version']);
// Parser definitions own routing arity and accepted values as well as help.
const GLOBAL_DEFINITIONS = new Map(
  Object.entries(globalFlags).map(([name, flag]) => [`--${name}`, flag]),
);
const VALUE_FLAGS = new Set(
  [...GLOBAL_DEFINITIONS].filter(([, flag]) => flag.type === 'option').map(([name]) => name),
);
const GLOBAL_FLAGS = new Set(GLOBAL_DEFINITIONS.keys());

function acceptsGlobalValue(name: string, value: string): boolean {
  const flag = GLOBAL_DEFINITIONS.get(name);
  return (
    flag?.type !== 'option' ||
    flag.options === undefined ||
    (flag.options as readonly string[]).includes(value)
  );
}

function globalAt(
  argv: readonly string[],
  index: number,
): { readonly tokens: readonly string[]; readonly last: number } | undefined {
  const token = argv[index] ?? '';
  const eq = token.indexOf('=');
  const name = eq === -1 ? token : token.slice(0, eq);
  const inline = eq === -1 ? undefined : token.slice(eq + 1);
  if (!GLOBAL_FLAGS.has(name)) return undefined;
  if (!VALUE_FLAGS.has(name))
    return inline === undefined ? { tokens: [token], last: index } : undefined;
  const value = inline ?? argv[index + 1];
  if (value === undefined || value === '' || value.startsWith('-')) return undefined;
  if (!acceptsGlobalValue(name, value)) return undefined;
  return inline === undefined
    ? { tokens: [token, value], last: index + 1 }
    : { tokens: [token], last: index };
}

interface Scan {
  readonly words: string[];
  readonly afterTerminator?: string | undefined;
  readonly leadingFlag?: string | undefined;
  readonly badValue?: { flag: string; value?: string } | undefined;
  readonly strayFlag?: string | undefined;
}

function scanArgv(argv: readonly string[]): Scan {
  const words: string[] = [];
  let badValue: Scan['badValue'];
  let strayFlag: string | undefined;
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i] ?? '';
    if (token === '--') return { words, afterTerminator: argv[i + 1], badValue, strayFlag };
    if (!token.startsWith('-')) {
      words.push(token);
      // Two words name any command; everything after belongs to it.
      if (words.length === 2) break;
      continue;
    }
    const eq = token.indexOf('=');
    const name = eq === -1 ? token : token.slice(0, eq);
    const inline = eq === -1 ? undefined : token.slice(eq + 1);
    // -h/--help/-v/--version pass through bare; any other leading flag —
    // or a help flag misspelled with a value — would become oclif's command name.
    if (words.length === 0 && VALUE_FLAGS.has(name)) {
      const value = inline ?? argv[i + 1];
      if (!value || value.startsWith('-') || !acceptsGlobalValue(name, value))
        return {
          words,
          badValue: { flag: name, ...(value && !value.startsWith('-') ? { value } : {}) },
        };
    }
    if (words.length === 0 && !(PRE_OK.has(name) && inline === undefined))
      return { words, leadingFlag: token };
    // A flag that takes no value but was given one is a bad spelling too.
    if (!PRE_OK.has(name) && !GLOBAL_FLAGS.has(name)) strayFlag ??= name;
    else if (inline !== undefined && !VALUE_FLAGS.has(name)) strayFlag ??= token;
    if (!VALUE_FLAGS.has(name)) continue;
    const next = inline ?? argv[i + 1];
    const usable = next !== undefined && next !== '' && !next.startsWith('-');
    // A missing or impossible value is wrong however the rest parses;
    // report it, not the topic help.
    if (!usable) badValue ??= { flag: name, ...(inline === undefined ? {} : { value: inline }) };
    else if (!acceptsGlobalValue(name, next)) badValue ??= { flag: name, value: next };
    if (inline === undefined && usable) i++;
  }
  return { words, badValue, strayFlag };
}

function hasCommandPrefix(words: readonly string[], commandIds: readonly string[]): boolean {
  for (let length = words.length; length >= 1; length--) {
    if (commandIds.includes(words.slice(0, length).join(' '))) return true;
  }
  return false;
}

function unknown(
  attempted: string,
  candidates: readonly string[],
  help: string,
  replacement?: readonly string[],
): Route {
  const suggestion = nearest(attempted, candidates);
  return {
    kind: 'unknown',
    attempted,
    ...(suggestion === undefined ? {} : { nearest: suggestion }),
    ...(replacement === undefined ? {} : { replacement }),
    help,
  };
}

// Retired command spellings, and how the rest of the line is rewritten
// into what answers the same intent now. The rest is read as flags and words
// first, so a flag keeps its value, a boolean keeps nothing, and a fixed
// replacement keeps the global flags (--dry-run above all) and drops the
// obsolete ones.
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
// `--version` takes no flag at all.
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

function retiredName(words: readonly string[]): string {
  const two = `${words[0] ?? ''} ${words[1] ?? ''}`;
  return two in RETIRED ? two : (words[0] ?? '');
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
