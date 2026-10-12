// Encoded PowerShell scripts have a fixed program body; values are quoted as
// literals, never interpolated into executable expressions by a caller's shell.

import { powershellQuote } from '../../domain/shell.js';

export function powershellVector(script: string): readonly string[] {
  return [
    'powershell.exe',
    '-NoLogo',
    '-NoProfile',
    '-NonInteractive',
    '-EncodedCommand',
    Buffer.from(script, 'utf16le').toString('base64'),
  ];
}

export function windowsHookCommand(vector: readonly string[], owner: string): string {
  const [binary = '', ...args] = vector;
  const commandLine = args.map(nativeQuote).join(' ');
  // A progress record (PowerShell's first-use module preparation, say) would reach
  // stderr serialized as CLIXML.
  const script = `# fx-owner:${owner}
$ProgressPreference = 'SilentlyContinue'
$ErrorActionPreference = 'Stop'
try {
  $s = New-Object System.Diagnostics.ProcessStartInfo
  $s.FileName = ${powershellQuote(binary)}
  $s.Arguments = ${powershellQuote(commandLine)}
  $s.UseShellExecute = $false
  $s.CreateNoWindow = $true
  $s.RedirectStandardInput = $true
  $s.RedirectStandardOutput = $true
  $s.RedirectStandardError = $true
  $p = [System.Diagnostics.Process]::Start($s)
  $o = $p.StandardOutput.BaseStream.CopyToAsync([Console]::OpenStandardOutput())
  $e = $p.StandardError.BaseStream.CopyToAsync([System.IO.Stream]::Null)
  [Console]::OpenStandardInput().CopyTo($p.StandardInput.BaseStream)
  $p.StandardInput.Close()
  $p.WaitForExit()
  $o.GetAwaiter().GetResult()
  $e.GetAwaiter().GetResult()
} catch {}
exit 0`;
  return powershellVector(script).join(' ');
}

export function ownsWindowsHook(command: string, owner: string): boolean {
  const prefix = powershellVector('').slice(0, -1).join(' ') + ' ';
  if (!command.startsWith(prefix)) return false;
  const encoded = command.slice(prefix.length);
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)) return false;
  return Buffer.from(encoded, 'base64').toString('utf16le').startsWith(`# fx-owner:${owner}\n`);
}

function nativeQuote(value: string): string {
  return '"' + value.replace(/(\\*)"/g, '$1$1\\"').replace(/(\\+)$/, '$1$1') + '"';
}
