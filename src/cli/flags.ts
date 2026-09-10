// The global flags every command accepts, and the one flag every write
// command adds. Defined once so `--help`, the docs generator and the commands
// cannot disagree about them.

import { Flags } from '@oclif/core';

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
      'workspace name from ~/.fx/config.yaml; defaults to the registered one containing cwd, then default_workspace',
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

export const jobsFlag = Flags.integer({
  default: 4,
  min: 1,
  description: 'independent repository checks handled at the same time',
});
