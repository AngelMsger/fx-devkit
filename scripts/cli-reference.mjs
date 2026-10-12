// @ts-check
// Turns a command registry into the committed CLI reference. Kept apart from
// the generator entry so the rendering can be exercised without a build.

/**
 * The shapes this renderer reads from the built registry.
 * @typedef {{ char?: string, allowNo?: boolean, required?: boolean, multiple?: boolean,
 *   default?: unknown, exclusive?: string[], dependsOn?: string[], options?: string[],
 *   env?: string, description?: string, hidden?: boolean }} FlagSpec
 * @typedef {{ description?: string, required?: boolean, multiple?: boolean,
 *   default?: unknown }} ArgSpec
 * @typedef {{ description?: string, hidden?: boolean, strict?: boolean,
 *   args?: Record<string, ArgSpec>, flags?: Record<string, FlagSpec>,
 *   examples?: string[] }} CommandSpec
 * @typedef {{ bin: string, version: string, topics: Record<string, { description?: string }>,
 *   commands: Record<string, CommandSpec>, aliases: Record<string, string>,
 *   everyday: string[], globalFlags: Record<string, FlagSpec> }} Registry
 */

/**
 * @param {Registry} registry
 * @returns {string}
 */
export function renderCliReference(registry) {
  const { bin, globalFlags, aliases } = registry;
  /** @param {string} id */
  const commandName = (id) => `${bin} ${id.replaceAll(':', ' ')}`;
  /** @param {string} text */
  const example = (text) => text.replaceAll('<%= config.bin %>', bin);
  /** @param {CommandSpec} command */
  const summary = (command) => (command.description ?? '').split('\n')[0];

  const commands = Object.fromEntries(
    Object.entries(registry.commands).filter(
      ([id, command]) => !command.hidden && !(id in aliases),
    ),
  );

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
  // order with its commands as the registry lists them. An everyday command that
  // belongs to a topic is described once, among the everyday ones.
  /** @param {string} id */
  const topicOf = (id) => (id.includes(':') ? (id.split(':')[0] ?? null) : null);
  const topics = [
    ...new Set(
      Object.keys(commands)
        .map(topicOf)
        .filter((topic) => topic !== null),
    ),
  ].sort();
  const ordered = [
    ...registry.everyday.map((id) => /** @type {[string, CommandSpec]} */ ([id, commands[id]])),
    ...topics.flatMap((topic) =>
      Object.entries(commands).filter(
        ([id]) => topicOf(id) === topic && !registry.everyday.includes(id),
      ),
    ),
  ];

  const lines = [
    '# fx-devkit command reference',
    '',
    `Command syntax for the current source (package version ${registry.version}).`,
    'See the [version history](../../CHANGELOG.md) for changes between releases.',
    'Use `fx <command> --help` for the exact syntax supported by your executable.',
    '',
    '## Everyday',
    '',
    '| Command | What it answers |',
    '|---|---|',
    ...registry.everyday.map(
      (id) => `| \`${commandName(id)}\` | ${summary(/** @type {CommandSpec} */ (commands[id]))} |`,
    ),
    '',
    '## Topics',
    '',
    '| Topic | Commands |',
    '|---|---|',
    ...topics.map(
      (topic) => `| \`${bin} ${topic}\` | ${registry.topics[topic]?.description ?? ''} |`,
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
    ...Object.entries(aliases).map(
      ([alias, canonical]) => `| \`${commandName(alias)}\` | \`${commandName(canonical)}\` |`,
    ),
    '',
  );
  // Retain old anchors for existing documentation links.
  for (const [alias, canonical] of Object.entries(aliases))
    lines.push(`## \`${commandName(alias)}\``, '', `Alias of \`${commandName(canonical)}\`.`, '');
  return lines.join('\n').replace(/\n+$/, '\n');
}
