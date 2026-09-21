import { Args, Flags } from '@oclif/core';

import { Init } from '../../application/init/index.js';
import { manifestSourceFor, resumedInitialization } from '../../composition/manifest-sources.js';
import { DevkitError } from '../../domain/errors.js';
import { FxCommand } from '../base.js';
import { dryRunFlag, jobsFlag, writeIntent } from '../flags.js';
import { readStdin } from '../stdin.js';

export default class InitCommand extends FxCommand {
  static override description =
    'Prepare a workspace from a manifest, or continue unfinished preparation\n\nProvide a directory and source. fx prepares the selected repositories, local tools and Agent guides, then verifies the result. Only local prepare steps execute automatically, even with --yes; personal sign-in is a handoff. Read preparation.next for the next decision. After completing them, use init --resume --workspace <name>. Existing user files and completed work are preserved.';
  static override examples = [
    '<%= config.bin %> init ~/Workspaces/fx --from ssh://git@git.example.com/team/workspace-manifest.git',
    '<%= config.bin %> init ./ws --from ./manifest --repos api --dry-run',
    '<%= config.bin %> init --resume --workspace ws',
    'cat workspace.yaml | <%= config.bin %> init ./ws --from -',
  ];
  static override args = {
    dir: Args.string({ description: 'directory to prepare; omitted with --resume' }),
  };
  static override flags = {
    resume: Flags.boolean({
      description: 'continue a registered workspace without reimporting its source',
      exclusive: ['from', 'name', 'repos', 'no-repos'],
    }),
    from: Flags.string({
      description:
        'git URL or checkout of the manifest repository, a directory holding manifest/, or - for workspace YAML / a source bundle',
    }),
    name: Flags.string({
      description: 'registration name; default: an available name derived from the directory',
    }),
    repos: Flags.string({
      exclusive: ['no-repos'],
      description:
        'comma-separated shared repositories to select before the first clone; replaces existing shared selection when provided',
    }),
    'no-repos': Flags.boolean({
      exclusive: ['repos'],
      description:
        'select no shared repositories; still prepares declared tools and agent resources',
    }),
    adopt: Flags.boolean({ hidden: true, default: false, description: 'adoption is automatic' }),
    jobs: jobsFlag,
    'dry-run': dryRunFlag,
  };
  async run(): Promise<void> {
    const { args, flags } = await this.parse(InitCommand);
    this.skipUpdateChecks();
    if (flags.resume && (!flags.workspace || args.dir))
      throw new DevkitError(
        'usage',
        'INIT_INPUT_REQUIRED',
        'Use init --resume --workspace <name> without a directory',
        { nextSteps: ['fx workspace list'] },
      );
    if (!flags.resume && (!args.dir || !flags.from))
      throw new DevkitError(
        'usage',
        'INIT_INPUT_REQUIRED',
        'Choose a workspace directory and manifest source',
        { nextSteps: ['fx init <directory> --from <source>'] },
      );
    const resumed = flags.resume
      ? await resumedInitialization(flags.workspace!, this.container)
      : undefined;
    const source =
      resumed?.source ??
      (await manifestSourceFor(flags.from!, this.container, readStdin, this.replacement()));
    const result = await new Init(this.initDeps()).execute({
      dir: resumed?.dir ?? args.dir!,
      source,
      name: resumed?.name ?? flags.name,
      resume: flags.resume,
      repos: flags['no-repos'] ? [] : flags.repos?.split(',').map((name) => name.trim()),
      adopt: flags.adopt,
      ...writeIntent(flags, this.posture),
      jobs: flags.jobs,
    });
    this.renderPreparation(result);
  }
}
