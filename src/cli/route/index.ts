// Validate command routing before oclif can turn invalid invocations into topic help.

import { nearest } from '../../domain/fuzzy.js';

import { retiredCommand } from './retired.js';
import { PRE_OK, readFlag } from './tokens.js';

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
  const rootWords: string[] = [];
  for (let index = 0; index < argv.length; index += 1) {
    const global = globalAt(argv, index);
    if (global) index = global.last;
    else rootWords.push(argv[index]!);
  }
  if (argv.length > 0 && rootWords.every((word) => PRE_OK.has(word)))
    return rootWords.length ? rootWords : ['--help'];
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
    if (token === '--' || token.startsWith('-'))
      return words.length ? [...words, ...globals, ...argv.slice(i)] : [...argv];
    words.push(token);
    const attempted = words.join(' ');
    // A command may share its name with a topic (`release`, `release check`): the
    // longer name wins when the next word, past any global flags, completes it.
    if (commandIds.includes(attempted) && !commandIds.includes(`${attempted} ${nextWord(argv, i)}`))
      return [...words, ...globals, ...argv.slice(i + 1)];
    if (!commandIds.some((id) => id.startsWith(`${attempted} `)))
      return globals.length === 0 ? [...argv] : [...words, ...globals, ...argv.slice(i + 1)];
  }
  return [...words, ...globals];
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
  const retired = retiredCommand(words, argv);
  if (retired !== undefined)
    return unknown(retired.name, discoverableIds, '--help', retired.replacement);
  const children = discoverableIds.filter((id) => id.startsWith(`${topic} `));
  if (children.length === 0) return unknown(topic, discoverableIds, '--help');
  // `fx self -- bogus` names no subcommand either, and `fx self --bogus` asks
  // a topic to parse a flag no global owns; topics do not parse.
  const stray = words[1] ?? afterTerminator;
  if (stray !== undefined) return unknown(`${topic} ${stray}`, children, `${topic} --help`);
  if (scan.strayFlag !== undefined) return { kind: 'stray-flag', topic, flag: scan.strayFlag };
  return { kind: 'run' };
}

// The first argv entry after `index` that no global flag owns.
function nextWord(argv: readonly string[], index: number): string | undefined {
  for (let i = index + 1; i < argv.length; i += 1) {
    const taken = globalAt(argv, i);
    if (taken === undefined) return argv[i];
    i = taken.last;
  }
  return undefined;
}

// A global flag that oclif can be handed as it stands, with the argv entries it owns.
function globalAt(
  argv: readonly string[],
  index: number,
): { readonly tokens: readonly string[]; readonly last: number } | undefined {
  const flag = readFlag(argv, index);
  if (flag === undefined || !flag.global) return undefined;
  if (!flag.takesValue)
    return flag.inline === undefined ? { tokens: [flag.token], last: index } : undefined;
  if (!flag.accepted) return undefined;
  return flag.inline === undefined
    ? { tokens: [flag.token, flag.value!], last: flag.last }
    : { tokens: [flag.token], last: index };
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
    const flag = readFlag(argv, i);
    if (flag === undefined) {
      words.push(token);
      // Two words name any command; everything after belongs to it.
      if (words.length === 2) break;
      continue;
    }
    // -h/--help/-v/--version pass through bare; any other leading flag —
    // or a help flag misspelled with a value — would become oclif's command name.
    if (words.length === 0 && flag.takesValue && !flag.accepted)
      return { words, badValue: badFlag(flag.name, flag.usable ? flag.value : undefined) };
    if (words.length === 0 && !(PRE_OK.has(flag.name) && flag.inline === undefined))
      return { words, leadingFlag: token };
    if (!PRE_OK.has(flag.name) && !flag.global) strayFlag ??= flag.name;
    else if (flag.inline !== undefined && !flag.takesValue) strayFlag ??= token;
    if (!flag.takesValue) continue;
    if (!flag.usable) badValue ??= badFlag(flag.name, flag.inline);
    else if (!flag.accepted) badValue ??= badFlag(flag.name, flag.value);
    i = flag.last;
  }
  return { words, badValue, strayFlag };
}

// An empty value is reported; an absent one leaves the field out.
function badFlag(flag: string, value: string | undefined): { flag: string; value?: string } {
  return value === undefined ? { flag } : { flag, value };
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
