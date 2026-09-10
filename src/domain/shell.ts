// A vector printed as one line a person can paste into a shell. fx never
// runs the result; it only has to survive being copied.

import { DevkitError } from './errors.js';

export const COMMAND_SHELLS = ['auto', 'posix', 'powershell', 'cmd'] as const;
export type CommandShell = (typeof COMMAND_SHELLS)[number];
export type ResolvedShell = Exclude<CommandShell, 'auto'>;

const SAFE = /^[A-Za-z0-9_@%+=:,./-]+$/;

export function resolveCommandShell(value: string | undefined, windows: boolean): ResolvedShell {
  if (!value || value === 'auto') return windows ? 'powershell' : 'posix';
  if (value === 'posix' || value === 'powershell' || value === 'cmd') return value;
  throw new DevkitError('config', 'CONFIG_INVALID', `Unknown command shell: ${value}`, {
    nextSteps: ['fx config set command_shell auto'],
  });
}

export function shellLine(vector: readonly string[], shell: ResolvedShell = 'posix'): string {
  if (shell === 'powershell') return `& ${vector.map(powershellQuote).join(' ')}`;
  if (shell === 'cmd') {
    const [binary = '', ...args] = vector;
    return [binary.replace(/([()%!^"<>&|\s])/g, '^$1'), ...args.map(cmdQuote)].join(' ');
  }
  return vector
    .map((arg) => (SAFE.test(arg) ? arg : `'${arg.replaceAll("'", "'\\''")}'`))
    .join(' ');
}

export function powershellQuote(arg: string): string {
  return `'${arg.replaceAll("'", "''")}'`;
}

export function changeDirectoryCommand(root: string, shell: ResolvedShell = 'posix'): string {
  if (shell === 'powershell') return `Set-Location -LiteralPath ${powershellQuote(root)}`;
  if (shell === 'cmd') return `cd /d ${root.replace(/([()%!^"<>&|\s])/g, '^$1')}`;
  return `cd ${shellLine([root])}`;
}

function cmdQuote(arg: string): string {
  // cmd consumes carets before the native executable parses its command line.
  const quoted = '"' + arg.replace(/(\\*)"/g, '$1$1\\"').replace(/(\\+)$/, '$1$1') + '"';
  return quoted.replace(/([()%!^"<>&|])/g, '^$1');
}
