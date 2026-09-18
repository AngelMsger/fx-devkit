// @ts-check
// Generates docs/cli/README.md from the built command registry so the
// reference can never drift from the code; `--check` fails when the committed
// file differs from what the registry would produce now.

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const target = path.join(root, 'docs', 'cli', 'README.md');
const check = process.argv.includes('--check');

const {
  COMMANDS: registry,
  COMMAND_ALIASES,
  EVERYDAY,
} = await import(path.join(root, 'dist', 'cli', 'commands', 'index.js'));
const COMMANDS = Object.fromEntries(
  Object.entries(registry).filter(([id, command]) => !command.hidden && !(id in COMMAND_ALIASES)),
);
const { globalFlags } = await import(path.join(root, 'dist', 'cli', 'flags.js'));
const pkg = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'));

/**
 * The shapes this generator reads from the built registry.
 * @typedef {{ char?: string, allowNo?: boolean, required?: boolean, multiple?: boolean,
 *   default?: unknown, exclusive?: string[], dependsOn?: string[], options?: string[],
 *   env?: string, description?: string, hidden?: boolean }} FlagSpec
 * @typedef {{ description?: string, required?: boolean, multiple?: boolean,
 *   default?: unknown }} ArgSpec
 * @typedef {{ description?: string, hidden?: boolean, strict?: boolean,
 *   args?: Record<string, ArgSpec>, flags?: Record<string, FlagSpec>,
 *   examples?: string[] }} CommandSpec
 */

const bin = pkg.oclif?.bin ?? 'fx';
/** @param {string} id */
const commandName = (id) => `${bin} ${id.replaceAll(':', ' ')}`;
/** @param {string} text */
const example = (text) => text.replaceAll('<%= config.bin %>', bin);

/**
 * @param {string} name
 * @param {FlagSpec} flag
 */
function flagRow(name, flag) {
  const spelling = [
    flag.char ? `-${flag.char}` : null,
    flag.allowNo ? `--${name} / --no-${name}` : `--${name}`,
  ]
    .filter(Boolean)
    .join(', ');
  const details = [];
  if (flag.required) details.push('required');
  if (flag.multiple) details.push('repeatable');
  if (flag.default !== undefined && typeof flag.default !== 'function')
    details.push(`default: ${JSON.stringify(flag.default)}`);
  if (flag.exclusive?.length)
    details.push(`exclusive with: ${flag.exclusive.map((name) => `--${name}`).join(', ')}`);
  if (flag.dependsOn?.length)
    details.push(`requires: ${flag.dependsOn.map((name) => `--${name}`).join(', ')}`);
  if (flag.options) details.push(`one of: ${flag.options.join(', ')}`);
  if (flag.env) details.push(`env: ${flag.env}`);
  const description = [flag.description ?? '', details.length ? `(${details.join('; ')})` : '']
    .filter(Boolean)
    .join(' ');
  return `| \`${spelling}\` | ${description} |`;
}

/** @param {Record<string, FlagSpec>} flags */
function flagTable(flags) {
  const rows = Object.entries(flags)
    .filter(([, flag]) => !flag.hidden)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([name, flag]) => flagRow(name, flag));
  return ['| Flag | Description |', '|---|---|', ...rows];
}

/**
 * @param {string} id
 * @param {CommandSpec} command
 */
function section(id, command) {
  const lines = [`## \`${commandName(id)}\``, ''];
  if (command.description) lines.push(command.description, '');
  const args = Object.entries(command.args ?? {});
  if (args.length) {
    lines.push('Arguments:', '', '| Argument | Required | Description |', '|---|---|---|');
    for (const [name, arg] of args) {
      const variadic = arg.multiple || (command.strict === false && name === args.at(-1)?.[0]);
      const details = [
        arg.description ?? '',
        variadic ? '(variadic)' : '',
        arg.default === undefined ? '' : `(default: ${JSON.stringify(arg.default)})`,
      ]
        .filter(Boolean)
        .join(' ');
      lines.push(`| \`${name}\` | ${arg.required ? 'yes' : 'no'} | ${details} |`);
    }
    lines.push('');
  }
  const own = Object.entries(command.flags ?? {}).filter(([name]) => !(name in globalFlags));
  if (own.length) lines.push('Flags:', '', ...flagTable(Object.fromEntries(own)), '');
  const examples = command.examples ?? [];
  if (examples.length) {
    lines.push('Examples:', '', '```bash', ...examples.map(example), '```', '');
  }
  return lines;
}

// Everyday commands first, in their own order; then each topic in alphabetical
// order with its commands as the registry lists them.
/** @param {string} id */
const topicOf = (id) => (id.includes(':') ? (id.split(':')[0] ?? null) : null);
const topics = [
  ...new Set(
    Object.keys(COMMANDS)
      .map(topicOf)
      .filter((topic) => topic !== null),
  ),
].sort();
const ordered = [
  .../** @type {string[]} */ (EVERYDAY).map((id) => [id, COMMANDS[id]]),
  ...topics.flatMap((topic) => Object.entries(COMMANDS).filter(([id]) => topicOf(id) === topic)),
];
/** @param {CommandSpec} command */
const summary = (command) => (command.description ?? '').split('\n')[0];

const lines = [
  '# fx-devkit command reference',
  '',
  `Generated from the command registry of version ${pkg.version}. Do not edit by hand;`,
  'run `npm run docs:gen` after changing commands or flags.',
  '',
  '## Everyday',
  '',
  '| Command | What it answers |',
  '|---|---|',
  .../** @type {string[]} */ (EVERYDAY).map(
    (id) => `| \`${commandName(id)}\` | ${summary(COMMANDS[id])} |`,
  ),
  '',
  '## Topics',
  '',
  '| Topic | Commands |',
  '|---|---|',
  ...topics.map(
    (topic) => `| \`${bin} ${topic}\` | ${pkg.oclif?.topics?.[topic]?.description ?? ''} |`,
  ),
  '',
  '## Global flags',
  '',
  'Every command accepts these.',
  '',
  ...flagTable(globalFlags),
  '',
];
for (const [id, command] of ordered) lines.push(...section(id, command));
lines.push(
  '## Compatibility aliases',
  '',
  'These names remain executable. Help and command-name completion prefer their canonical entries.',
  '',
  '| Alias | Canonical command |',
  '|---|---|',
  ...Object.entries(COMMAND_ALIASES).map(
    ([alias, canonical]) => `| \`${commandName(alias)}\` | \`${commandName(canonical)}\` |`,
  ),
  '',
);
// Retain old anchors for existing documentation links.
for (const [alias, canonical] of Object.entries(COMMAND_ALIASES))
  lines.push(`## \`${commandName(alias)}\``, '', `Alias of \`${commandName(canonical)}\`.`, '');
const output = lines.join('\n').replace(/\n+$/, '\n');

if (check) {
  let current;
  try {
    current = readFileSync(target, 'utf8');
  } catch {
    current = '';
  }
  if (current !== output) {
    console.error(`${path.relative(root, target)} is out of date; run npm run docs:gen`);
    process.exit(1);
  }
} else {
  mkdirSync(path.dirname(target), { recursive: true });
  writeFileSync(target, output);
  console.error(`wrote ${path.relative(root, target)}`);
}
