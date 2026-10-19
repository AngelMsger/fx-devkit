// Starts git for the adapters that read its output. They match its English messages, so
// the locale is pinned; a git that could not start is reported as the missing tool.

import { toolMissingError } from '../../domain/errors.js';
import type { Process, ProcessResult, RunOptions } from '../../ports/process.js';

export async function runGit(
  process: Process,
  args: readonly string[],
  options: RunOptions = {},
): Promise<ProcessResult> {
  const result = await process.run(['git', ...args], {
    ...options,
    env: { ...options.env, LC_ALL: 'C' },
  });
  if (result.notStarted) throw toolMissingError('git', { nextSteps: ['fx can git'] });
  return result;
}

export function lastLine(text: string): string {
  const lines = text.trim().split('\n');
  return lines[lines.length - 1] ?? '';
}
