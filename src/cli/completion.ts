// Static completion scripts from the command registry. They complete
// command words and flag names; values are the commands' own business.

import { DevkitError } from '../domain/errors.js';
import { nearest } from '../domain/fuzzy.js';

export const SHELLS = ['bash', 'zsh', 'fish', 'powershell'] as const;
export type Shell = (typeof SHELLS)[number];

export interface CompletionCommand {
  readonly id: string;
  readonly flags: readonly string[];
}

export function completionScript(
  shell: string,
  commands: readonly CompletionCommand[],
  globalFlags: readonly string[],
): string {
  if (!(SHELLS as readonly string[]).includes(shell)) {
    const suggestion = nearest(shell, SHELLS);
    throw new DevkitError('usage', 'SHELL_UNKNOWN', `"${shell}" is not a shell fx can complete`, {
      hint:
        suggestion === undefined
          ? `Choose one of ${SHELLS.join(', ')}.`
          : `Did you mean "${suggestion}"?`,
      nextSteps: SHELLS.map((s) => `fx completion ${s}`),
    });
  }
  const tree = commandTree(commands);
  const flagsOf = (id: string): string =>
    [...(commands.find((c) => c.id === id)?.flags ?? []), ...globalFlags]
      .map((f) => `--${f}`)
      .join(' ');
  return { bash, zsh, fish, powershell }[shell as Shell](tree, flagsOf, commands, globalFlags);
}

function powershell(tree: Tree, flagsOf: (id: string) => string): string {
  const quote = (value: string): string => "'" + value.replaceAll("'", "''") + "'";
  const entries = [...tree.entries()].flatMap(([topic, subs]) => [
    `${quote(topic)} = @(${subs.map(quote).join(', ')})`,
    ...[topic, ...subs.map((sub) => `${topic} ${sub}`)].map(
      (id) =>
        `${quote(id + ':flags')} = @(${flagsOf(id).split(' ').filter(Boolean).map(quote).join(', ')})`,
    ),
  ]);
  return `# fx PowerShell completion: dot-source this file from your profile.
$fxCommands = @{ ${entries.join('; ')} }
$fxRoots = @(${[...tree.keys()].map(quote).join(', ')})
$fxCompleter = {
  param($wordToComplete, $commandAst, $cursorPosition)
  $words = @($commandAst.CommandElements | Select-Object -Skip 1 | Where-Object { $_.Extent.EndOffset -lt $cursorPosition } | ForEach-Object { $_.Extent.Text })
  $id = $words -join ' '
  if ($wordToComplete.StartsWith('-')) { $candidates = $fxCommands[$id + ':flags'] }
  elseif ($words.Count -eq 0) { $candidates = $fxRoots }
  else { $candidates = $fxCommands[$id] }
  foreach ($candidate in $candidates) {
    if ($candidate.StartsWith($wordToComplete, [StringComparison]::OrdinalIgnoreCase)) {
      [System.Management.Automation.CompletionResult]::new($candidate, $candidate, 'ParameterValue', $candidate)
    }
  }
}.GetNewClosure()
$fxCompletionParams = @{ CommandName = @('fx', 'fx.cmd'); ScriptBlock = $fxCompleter }
if ((Get-Command Register-ArgumentCompleter).Parameters.ContainsKey('Native')) { $fxCompletionParams.Native = $true }
Register-ArgumentCompleter @fxCompletionParams
`;
}

type Tree = Map<string, string[]>;

function commandTree(commands: readonly CompletionCommand[]): Tree {
  const tree: Tree = new Map();
  for (const { id } of commands) {
    const [head = '', ...rest] = id.split(' ');
    if (!tree.has(head)) tree.set(head, []);
    if (rest.length > 0) tree.get(head)?.push(rest.join(' '));
  }
  return tree;
}

function bash(tree: Tree, flagsOf: (id: string) => string): string {
  const cases = [...tree.entries()]
    .filter(([, subs]) => subs.length > 0)
    .map(
      ([topic, subs]) =>
        `      ${topic}) COMPREPLY=( $(compgen -W "${subs.join(' ')}" -- "$cur") ); return ;;`,
    )
    .join('\n');
  const flagCases = [...tree.entries()]
    .flatMap(([topic, subs]) =>
      subs.length === 0 ? [[topic, topic]] : subs.map((s) => [`${topic} ${s}`, `${topic}_${s}`]),
    )
    .map(
      ([id]) =>
        `      "${id}") COMPREPLY=( $(compgen -W "${flagsOf(id ?? '')}" -- "$cur") ); return ;;`,
    )
    .join('\n');
  return [
    '# fx bash completion: source this file, or place it in bash_completion.d',
    '_fx() {',
    '  local cur="${COMP_WORDS[COMP_CWORD]}"',
    '  local words=("${COMP_WORDS[@]:1:COMP_CWORD-1}")',
    '  local cmd="${words[*]}"',
    '  if [[ "$cur" == -* ]]; then',
    '    case "$cmd" in',
    flagCases,
    '    esac',
    '  fi',
    '  case "$COMP_CWORD" in',
    `    1) COMPREPLY=( $(compgen -W "${[...tree.keys()].join(' ')}" -- "$cur") ); return ;;`,
    '  esac',
    '  case "${COMP_WORDS[1]}" in',
    cases,
    '  esac',
    '}',
    'complete -F _fx fx',
    '',
  ].join('\n');
}

function zsh(tree: Tree, flagsOf: (id: string) => string): string {
  const subs = [...tree.entries()]
    .filter(([, s]) => s.length > 0)
    .map(([topic, s]) => `    ${topic}) compadd -- ${s.join(' ')} ;;`)
    .join('\n');
  const flags = [...tree.entries()]
    .flatMap(([topic, s]) => (s.length === 0 ? [topic] : s.map((x) => `${topic} ${x}`)))
    .map((id) => `    "${id}") compadd -- ${flagsOf(id)} ;;`)
    .join('\n');
  return [
    '#compdef fx',
    '# fx zsh completion: place this file as _fx on your fpath',
    '_fx() {',
    '  local -a words_; words_=("${words[@]:1:CURRENT-2}")',
    '  local cmd="${words_[*]}"',
    '  if [[ "${words[CURRENT]}" == -* ]]; then',
    '    case "$cmd" in',
    flags,
    '    esac',
    '    return',
    '  fi',
    '  if (( CURRENT == 2 )); then',
    `    compadd -- ${[...tree.keys()].join(' ')}`,
    '    return',
    '  fi',
    '  case "${words[2]}" in',
    subs,
    '  esac',
    '}',
    '_fx "$@"',
    '',
  ].join('\n');
}

function fish(
  tree: Tree,
  flagsOf: (id: string) => string,
  commands: readonly CompletionCommand[],
  globalFlags: readonly string[],
): string {
  const lines = [
    '# fx fish completion: place this file in ~/.config/fish/completions/fx.fish',
    'complete -c fx -f',
  ];
  for (const topic of tree.keys())
    lines.push(`complete -c fx -n '__fish_use_subcommand' -a ${topic}`);
  for (const [topic, subs] of tree.entries())
    for (const sub of subs)
      lines.push(`complete -c fx -n '__fish_seen_subcommand_from ${topic}' -a '${sub}'`);
  for (const flag of globalFlags) lines.push(`complete -c fx -l ${flag}`);
  for (const { id, flags } of commands) {
    const words = id.split(' ');
    for (const flag of flags)
      lines.push(
        `complete -c fx -n '__fish_seen_subcommand_from ${words[words.length - 1]}' -l ${flag}`,
      );
  }
  void flagsOf;
  return `${lines.join('\n')}\n`;
}
