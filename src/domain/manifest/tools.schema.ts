// The toolchain document: the bundled defaults/tools.yaml and the team's
// manifest/tools.yaml share this shape; the team file is a patch over the bundled one
// (see overlay.ts), so every field is optional here except a tool's name.

import * as z from 'zod';

import { commandVector, jsonExpectation, minCli, schemaVersion } from './common.schema.js';

export const INSTALLERS = ['npm', 'go', 'brew', 'manual'] as const;

export const installMethod = z
  .strictObject({
    via: z
      .enum(INSTALLERS)
      .describe('package manager: npm, go, brew, or manual for a tool installed by hand'),
    spec: z
      .string()
      .optional()
      .describe(
        'package the manager is asked for; an npm method may omit it and inherit defaults.npm_scope',
      ),
    registry: z
      .string()
      .optional()
      .describe('npm registry to install from, when not the default one'),
  })
  .describe('one way to install a tool');

export const skillCommand = z
  .strictObject({
    command: commandVector.describe(
      'arguments that install the companion Skill; empty means it ships none',
    ),
    agent_flag: z
      .string()
      .optional()
      .describe('flag naming one target agent, repeated per agent; absent means the tool chooses'),
    dir_flag: z
      .string()
      .optional()
      .describe('install once per selected global Skill directory when agent_flag is absent'),
  })
  .describe('how a tool installs its own companion Skill');

export const authCommand = z
  .strictObject({
    command: commandVector.describe(
      'arguments that report credential status; empty means no credentials are needed',
    ),
    docs: z.string().optional().describe('where signing in is documented'),
  })
  .describe('how a tool reports whether its credentials work');

export const verifyCheck = z
  .union([
    z.strictObject({
      command: commandVector.describe('tool arguments whose success proves the step'),
      json: jsonExpectation
        .optional()
        .describe('a JSON result that must also match; exit zero alone is otherwise sufficient'),
    }),
    z.strictObject({ file: z.string().describe('a path that must exist') }),
    z.strictObject({
      provider: z.literal('whoami').describe('ask the bound provider who the user is'),
    }),
  ])
  .describe('how the step is verified; doctor runs the same check');

export const setupStep = z
  .strictObject({
    id: z.string().min(1).describe('stable step id, referenced by local.setup and doctor'),
    kind: z
      .enum(['run', 'manual', 'file'])
      .describe(
        'run: fx executes it; manual: a person does it; file: a person puts a file in place',
      ),
    title: z.string().describe('one line shown before the step'),
    open: z.string().optional().describe('URL the person is pointed at'),
    instructions: z.string().optional().describe('what to do, in markdown'),
    run: commandVector.optional().describe('for kind run: the tool arguments fx executes'),
    expects: z
      .strictObject({ path: z.string().describe('the file the person must put in place') })
      .optional()
      .describe('for kind file: what must exist afterwards'),
    verify: verifyCheck,
    requires: z.array(z.string()).optional().describe('ids of steps that must pass first'),
  })
  .describe('one setup step the team adds beyond the provider recipe');

export const toolSchema = z
  .strictObject({
    name: z.string().min(1).describe("the tool's name, and by default its executable"),
    binary: z.string().optional().describe('executable to run; defaults to the name'),
    desc: z.string().optional().describe('one-line description shown in listings'),
    docs: z.string().optional().describe('where the tool documents itself'),
    min_version: z
      .string()
      .optional()
      .describe('lowest version that carries the features this workspace relies on'),
    required: z
      .boolean()
      .optional()
      .describe('whether the workspace is unusable without this tool'),
    enabled: z
      .boolean()
      .optional()
      .describe('false keeps the entry but marks the tool as no longer used by the team'),
    opt_in: z
      .boolean()
      .optional()
      .describe(
        'baseline only: fx knows this tool but does not assume it, so a workspace activates it by naming it',
      ),
    version_args: commandVector
      .optional()
      .describe(
        'arguments that make this tool print its version; defaults to defaults.version_args',
      ),
    install_on_init: z
      .boolean()
      .optional()
      .describe(
        'install this tool if missing during fx init, after command trust approval; default false',
      ),
    install: z
      .array(installMethod)
      .optional()
      .describe('how to install this tool, in order of preference; replaces defaults.install'),
    skill: skillCommand.optional(),
    auth: authCommand.optional(),
    setup: z.array(setupStep).optional().describe('manual or team-specific setup steps'),
  })
  .describe('one companion tool');

export const toolsSchema = z
  .strictObject({
    schema_version: schemaVersion,
    min_cli: minCli,
    defaults: z
      .strictObject({
        version_args: commandVector
          .optional()
          .describe('arguments that make a tool print its version'),
        npm_scope: z
          .string()
          .optional()
          .describe("npm scope prepended to a tool's name when an npm method gives no spec"),
        install: z
          .array(installMethod)
          .optional()
          .describe('how to install a tool, in order of preference'),
        skill: skillCommand.optional(),
        auth: authCommand.optional(),
      })
      .optional()
      .describe('conventions every tool inherits unless it overrides them'),
    tools: z.array(toolSchema).describe('the companion CLIs this workspace expects'),
  })
  .describe(
    'the companion toolchain: which CLIs the workspace uses and how to install, verify and set them up',
  );
