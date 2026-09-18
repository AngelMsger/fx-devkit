// Local contribution plumbing suppresses external diff helpers and optional
// index writes. Failures report an operation code without echoing Git output.

import { DevkitError } from '../../domain/errors.js';
import type { Process } from '../../ports/process.js';

interface ContributionCommand {
  readonly process: Process;
  readonly dir: string;
  readonly args: readonly string[];
  readonly input?: string;
  readonly index?: string;
  readonly allowAbsent?: boolean;
  readonly network?: boolean;
}

export async function runContributionGit(input: ContributionCommand): Promise<string> {
  const env: NodeJS.ProcessEnv = Object.fromEntries(
    Object.keys(process.env)
      .filter((key) => key.startsWith('GIT_'))
      .map((key) => [key, undefined]),
  );
  const result = await input.process.run(
    [
      'git',
      '--no-optional-locks',
      '-c',
      'core.fsmonitor=false',
      '-c',
      'core.splitIndex=false',
      '-C',
      input.dir,
      ...input.args,
    ],
    {
      env: {
        ...env,
        GIT_OPTIONAL_LOCKS: '0',
        GIT_INDEX_FILE: input.index,
        GIT_TERMINAL_PROMPT: '0',
      },
      timeoutMs: 15000,
      ...(input.input === undefined ? {} : { input: input.input }),
    },
  );
  if (result.code === 1 && input.allowAbsent) return '';
  if (result.code !== 0) {
    const rejected =
      input.network && /non-fast-forward|fetch first/.test(result.stdout + result.stderr);
    const category = input.network && !rejected ? 'network' : 'conflict';
    throw new DevkitError(
      category,
      rejected ? 'SOURCE_PUSH_REJECTED' : 'SOURCE_GIT_FAILED',
      'Contribution Git operation failed.',
      {
        hint: 'Inspect the source checkout and its Git configuration; no checkout or reset was attempted.',
        nextSteps: ['fx source push --help', 'Inspect the source Git status and retry.'],
      },
    );
  }
  return result.stdout;
}

export function assertObjectId(value: string): void {
  if (!/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/.test(value))
    throw new DevkitError(
      'conflict',
      'SOURCE_OBJECT_INVALID',
      'Expected a complete Git object identity.',
      { nextSteps: ['Check the source repository with git fsck, then re-run fx source push.'] },
    );
}
