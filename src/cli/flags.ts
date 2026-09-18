// The global flags every command accepts, and the one flag every write
// command adds. Defined once so `--help`, the docs generator and the commands
// cannot disagree about them.

import { Args, Flags, type Interfaces } from '@oclif/core';

import type { WritePosture } from '../application/safety/posture.js';
import { COMMAND_SHELLS } from '../domain/shell.js';

import { FORMATS } from './render/index.js';

export const globalFlags = {
  'command-shell': Flags.string({
    options: [...COMMAND_SHELLS],
    env: 'FX_COMMAND_SHELL',
    description: 'shell for generated commands (does not change execution)',
    helpGroup: 'GLOBAL',
  }),
  format: Flags.string({
    options: [...FORMATS],
    env: 'FX_FORMAT',
    description: 'output format',
    helpGroup: 'GLOBAL',
  }),
  fields: Flags.string({
    description: 'comma-separated dot paths to keep in the output, e.g. name,obs.svc',
    helpGroup: 'GLOBAL',
  }),
  workspace: Flags.string({
    env: 'FX_WORKSPACE',
    description:
      'select a workspace: containing cwd, then default_workspace when omitted; global commands still cover this FX_HOME',
    helpGroup: 'GLOBAL',
  }),
  'no-input': Flags.boolean({
    default: false,
    description: 'never prompt; fail with a structured error instead',
    helpGroup: 'GLOBAL',
  }),
  yes: Flags.boolean({
    default: false,
    description: 'assume yes for confirmations',
    helpGroup: 'GLOBAL',
  }),
  quiet: Flags.boolean({
    default: false,
    description: 'suppress notices on stderr; errors are still reported',
    helpGroup: 'GLOBAL',
  }),
  verbose: Flags.boolean({
    default: false,
    description: 'diagnostic detail on stderr',
    helpGroup: 'GLOBAL',
  }),
  'no-header': Flags.boolean({
    default: false,
    description: 'omit column headings from human list output',
    helpGroup: 'GLOBAL',
  }),
  'allow-writes': Flags.boolean({
    default: false,
    description: 'override read-only posture (read_only / FX_READ_ONLY) for this invocation',
    helpGroup: 'GLOBAL',
  }),
};

export const dryRunFlag = Flags.boolean({
  default: false,
  description: 'print the plan instead of applying it',
});

export const detailsFlag = Flags.boolean({
  default: false,
  description:
    'include all workflow report details in JSON; explicit --fields projects the full result',
});

export const jobsFlag = Flags.integer({
  default: 4,
  min: 1,
  description: 'independent checks handled at the same time',
});

export function listFlag(
  description: string,
  options?: readonly string[],
): Interfaces.OptionFlag<string[] | undefined> {
  return Flags.string({
    multiple: true,
    delimiter: ',',
    description: `${description} (repeatable or comma-separated)`,
    ...(options === undefined ? {} : { options: [...options] }),
  });
}

export interface WriteIntent {
  readonly dryRun: boolean;
  readonly posture: WritePosture;
}

// What every write use case is told: whether this invocation may have effects
// at all, and whether it was asked for the plan rather than the effect.
export function writeIntent(
  flags: { readonly 'dry-run': boolean },
  posture: WritePosture,
): WriteIntent {
  return { dryRun: flags['dry-run'], posture };
}

// A positional argument never reads stdin: piped input is a document for the
// command, not a missing value for its argument.
export function argument(description: string): Interfaces.Arg<string | undefined> {
  return Args.string({ ignoreStdin: true, description });
}

export function requiredArgument(description: string): Interfaces.Arg<string> {
  return Args.string({ ignoreStdin: true, required: true, description });
}
