// Generate shell completion from command and flag metadata. Scanners retain the
// command after positional arguments and skip option values before routing words.

import { DevkitError } from '../domain/errors.js';
import { nearest, suggestionHint } from '../domain/fuzzy.js';

export const SHELLS = ['bash', 'zsh', 'fish', 'powershell'] as const;
export type Shell = (typeof SHELLS)[number];
export interface CompletionFlag {
  readonly name: string;
  readonly takesValue: boolean;
  readonly options: readonly string[];
}
export interface CompletionCommand {
  readonly id: string;
  readonly aliasOf?: string | undefined;
  readonly flags: readonly CompletionFlag[];
}
interface FlagDefinition {
  readonly type?: string;
  readonly char?: string;
  readonly allowNo?: boolean;
  readonly hidden?: boolean;
  readonly options?: readonly string[];
}
export function completionFlags(
  definitions: Readonly<Record<string, FlagDefinition>>,
): CompletionFlag[] {
  return Object.entries(definitions).flatMap(([name, flag]) => {
    if (flag.hidden) return [];
    const names = [
      `--${name}`,
      ...(flag.allowNo ? [`--no-${name}`] : []),
      ...(flag.char ? [`-${flag.char}`] : []),
    ];
    return names.map((spelling) => ({
      name: spelling,
      takesValue: flag.type === 'option',
      options: flag.options ?? [],
    }));
  });
}
interface Entry {
  readonly id: string;
  readonly children: readonly string[];
  readonly routes: readonly string[];
  readonly flags: readonly CompletionFlag[];
}
export function completionScript(
  shell: string,
  commands: readonly CompletionCommand[],
  globals: readonly CompletionFlag[],
): string {
  if (!(SHELLS as readonly string[]).includes(shell)) {
    const suggestion = nearest(shell, SHELLS);
    throw new DevkitError('usage', 'SHELL_UNKNOWN', `"${shell}" is not a shell fx can complete`, {
      hint: suggestionHint(suggestion, `Choose one of ${SHELLS.join(', ')}.`),
      nextSteps: SHELLS.map((s) => `fx completion ${s}`),
    });
  }
  const ids = ['', ...new Set(commands.flatMap(({ id }) => [id.split(' ')[0]!, id]))];
  const entries = ids.map((id): Entry => ({
    id,
    children: childCommands(
      commands.filter((command) => command.aliasOf === undefined),
      id,
    ),
    routes: childCommands(commands, id),
    flags: [
      ...globals,
      ...(commands.find((command) => command.id === id)?.flags ?? []),
      { name: '--help', takesValue: false, options: [] },
      { name: '-h', takesValue: false, options: [] },
    ],
  }));
  if (shell === 'powershell') return powershell(entries);
  if (shell === 'fish') return fish(entries);
  return posix(shell as 'bash' | 'zsh', entries);
}
function childCommands(commands: readonly CompletionCommand[], id: string): string[] {
  return [
    ...new Set(
      commands.flatMap((command) => {
        if (id === '') return [command.id.split(' ')[0]!];
        return command.id.startsWith(`${id} `) ? [command.id.slice(id.length + 1)] : [];
      }),
    ),
  ];
}
const quote = (value: string): string => `'${value.replaceAll("'", "'\\''")}'`;
function posixScanner(entries: readonly Entry[]): string[] {
  const transitions = entries.flatMap((entry) =>
    entry.routes.map(
      (child) =>
        `      ${quote(`${entry.id}:${child}`)}) fx_cmd=${quote([entry.id, child].filter(Boolean).join(' '))} ;;`,
    ),
  );
  const options = entries.flatMap((entry) =>
    entry.flags
      .filter((flag) => flag.takesValue)
      .map(
        (flag) => `      ${quote(`${entry.id}:${flag.name}`)}) fx_pending=${quote(flag.name)} ;;`,
      ),
  );
  const values = entries.flatMap((entry) =>
    entry.flags
      .filter((flag) => flag.options.length)
      .map(
        (flag) =>
          `      ${quote(`${entry.id}:${flag.name}`)}) fx_candidates=${quote(flag.options.join(' '))} ;;`,
      ),
  );
  const flags = entries.map(
    (entry) =>
      `      ${quote(entry.id)}) fx_candidates=${quote(entry.flags.map((flag) => flag.name).join(' '))} ;;`,
  );
  const children = entries.map(
    (entry) => `      ${quote(entry.id)}) fx_candidates=${quote(entry.children.join(' '))} ;;`,
  );
  return [
    '_fx_candidates() {',
    '  local fx_cmd="" fx_pending="" fx_token',
    '  fx_candidates=""',
    '  for fx_token in "$@"; do',
    '    if [[ -n "$fx_pending" ]]; then fx_pending=""; continue; fi',
    '    if [[ "$fx_token" == -- ]]; then return; fi',
    '    case "$fx_cmd:$fx_token" in',
    ...options,
    '    esac',
    '    if [[ "$fx_token" == -* ]]; then continue; fi',
    '    case "$fx_cmd:$fx_token" in',
    ...transitions,
    '    esac',
    '  done',
    '  if [[ -n "$fx_pending" ]]; then',
    '    case "$fx_cmd:$fx_pending" in',
    ...values,
    '    esac',
    '  elif [[ "$fx_current" == -* ]]; then',
    '    case "$fx_cmd" in',
    ...flags,
    '    esac',
    '  else',
    '    case "$fx_cmd" in',
    ...children,
    '    esac',
    '  fi',
    '}',
  ];
}
function posix(shell: 'bash' | 'zsh', entries: readonly Entry[]): string {
  const common = posixScanner(entries);
  if (shell === 'bash')
    return [
      '# fx bash completion: source this file.',
      ...common,
      '_fx() {',
      '  local fx_current="${COMP_WORDS[COMP_CWORD]}" fx_candidates',
      '  _fx_candidates "${COMP_WORDS[@]:1:COMP_CWORD-1}"',
      '  COMPREPLY=( $(compgen -W "$fx_candidates" -- "$fx_current") )',
      '}',
      'complete -F _fx fx',
      '',
    ].join('\n');
  return [
    '#compdef fx',
    '# fx zsh completion: place this file as _fx on your fpath.',
    ...common,
    '_fx() {',
    '  local fx_current="${words[CURRENT]}" fx_candidates',
    '  local -a fx_previous fx_matches',
    '  if (( CURRENT > 2 )); then fx_previous=("${words[@]:1:$((CURRENT - 2))}"); fi',
    '  _fx_candidates "${fx_previous[@]}"',
    '  fx_matches=( ${(z)fx_candidates} )',
    '  if (( ${#fx_matches} )); then compadd -- "${fx_matches[@]}"; fi',
    '}',
    '_fx "$@"',
    '',
  ].join('\n');
}
function powershell(entries: readonly Entry[]): string {
  const q = (value: string): string => `'${value.replaceAll("'", "''")}'`;
  const array = (values: readonly string[]): string => `@(${values.map(q).join(', ')})`;
  const metadata = entries.map(
    (entry) =>
      `${q(entry.id)} = @{ children = ${array(entry.children)}; routes = ${array(entry.routes)}; flags = ${array(entry.flags.map((flag) => flag.name))}; values = @{ ${entry.flags
        .filter((flag) => flag.takesValue)
        .map((flag) => `${q(flag.name)} = ${array(flag.options)}`)
        .join('; ')} } }`,
  );
  return `# fx PowerShell completion: dot-source this file from your profile.
$fxCommands = @{ ${metadata.join('; ')} }
$fxCompleter = {
  param($wordToComplete, $commandAst, $cursorPosition)
  $words = @($commandAst.CommandElements | Select-Object -Skip 1 | Where-Object { $_.Extent.EndOffset -lt $cursorPosition } | ForEach-Object { if ($null -ne $_.Value) { $_.Value } else { $_.Extent.Text } })
  $id = ''; $pending = ''
  foreach ($word in $words) {
    if ($pending) { $pending = ''; continue }
    if ($word -eq '--') { return }
    if ($fxCommands[$id].values.ContainsKey($word)) { $pending = $word; continue }
    if ($word.StartsWith('-')) { continue }
    if ($fxCommands[$id].routes -contains $word) { $id = ($id + ' ' + $word).Trim() }
  }
  if ($pending) { $candidates = $fxCommands[$id].values[$pending] }
  elseif ($wordToComplete.StartsWith('-')) { $candidates = $fxCommands[$id].flags }
  else { $candidates = $fxCommands[$id].children }
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
function fishCases(entries: readonly Entry[]): {
  transitions: string[];
  options: string[];
  values: string[];
  flags: string[];
  children: string[];
} {
  const q = (value: string): string => `'${value.replaceAll('\\', '\\\\').replaceAll("'", "\\'")}'`;
  const transitions = entries.flatMap((entry) =>
    entry.routes.map(
      (child) =>
        `      case ${q(`${entry.id}:${child}`)}\n        set fx_cmd ${q([entry.id, child].filter(Boolean).join(' '))}`,
    ),
  );
  const options = entries.flatMap((entry) =>
    entry.flags
      .filter((flag) => flag.takesValue)
      .map(
        (flag) =>
          `      case ${q(`${entry.id}:${flag.name}`)}\n        set fx_pending ${q(flag.name)}`,
      ),
  );
  const values = entries.flatMap((entry) =>
    entry.flags
      .filter((flag) => flag.options.length)
      .map(
        (flag) =>
          `      case ${q(`${entry.id}:${flag.name}`)}\n        printf '%s\\n' ${flag.options.map(q).join(' ')}`,
      ),
  );
  const flags = entries.map(
    (entry) =>
      `      case ${q(entry.id)}\n        printf '%s\\n' ${entry.flags.map((flag) => q(flag.name)).join(' ')}`,
  );
  const children = entries
    .filter((entry) => entry.children.length)
    .map(
      (entry) =>
        `      case ${q(entry.id)}\n        printf '%s\\n' ${entry.children.map(q).join(' ')}`,
    );
  return { transitions, options, values, flags, children };
}
function fish(entries: readonly Entry[]): string {
  const { transitions, options, values, flags, children } = fishCases(entries);
  return [
    '# fx fish completion: place this file in completions/fx.fish.',
    'function _fx_complete',
    '  set -l fx_words (commandline -opc)',
    '  set -l fx_cmd ""',
    '  set -l fx_pending ""',
    '  for fx_token in $fx_words[2..-1]',
    '    if test -n "$fx_pending"; set fx_pending ""; continue; end',
    '    if test "$fx_token" = --; return; end',
    '    switch "$fx_cmd:$fx_token"',
    ...options,
    '    end',
    '    if string match -q -- "-*" "$fx_token"; continue; end',
    '    switch "$fx_cmd:$fx_token"',
    ...transitions,
    '    end',
    '  end',
    '  if test -n "$fx_pending"',
    '    switch "$fx_cmd:$fx_pending"',
    ...values,
    '    end',
    '  else if string match -q -- "-*" (commandline -ct)',
    '    switch "$fx_cmd"',
    ...flags,
    '    end',
    '  else',
    '    switch "$fx_cmd"',
    ...children,
    '    end',
    '  end',
    'end',
    "complete -c fx -f -a '(_fx_complete)'",
    '',
  ].join('\n');
}
