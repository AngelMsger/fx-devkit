import { Flags } from '@oclif/core';

import { Init } from '../../application/init.js';
import { manifestSourceFor } from '../../composition/manifest-sources.js';
import { FxCommand } from '../base.js';
import { detailsFlag, dryRunFlag, jobsFlag, requiredArgument, writeIntent } from '../flags.js';
import { readStdin } from '../stdin.js';

export default class InitCommand extends FxCommand {
  static override description =
    'Create a workspace from a manifest source: the source lands under ~/.fx, the directory is registered and synced\n\nTools marked install_on_init are installed if missing, after command trust approval and before synchronization. Existing installations are preserved. Declared public service settings are prepared before repository queries; each member obtains their own credentials.\n\nRegistration can succeed with partial synchronization. Inspect sync.summary, sync.stages and failed item details; exit zero does not establish complete preparation.';
  static override examples = [
    '<%= config.bin %> init ~/Workspaces/fx --from ssh://git@git.example.com/team/workspace-manifest.git',
    '<%= config.bin %> init ./ws --from ./manifest --repos api --dry-run',
    'cat workspace.yaml | <%= config.bin %> init ./ws --from -',
  ];
  static override args = {
    dir: requiredArgument('directory to create, reuse or adopt'),
  };
  static override flags = {
    details: detailsFlag,
    from: Flags.string({
      required: true,
      description:
        'git URL or checkout of the manifest repository, a directory holding manifest/, or - for workspace YAML / a source bundle',
    }),
    name: Flags.string({ description: 'name in ~/.fx/config.yaml; default: the directory name' }),
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
    adopt: Flags.boolean({ default: false, description: 'legacy flag; adoption is automatic' }),
    jobs: jobsFlag,
    'dry-run': dryRunFlag,
  };
  async run(): Promise<void> {
    const { args, flags } = await this.parse(InitCommand);
    const source = await manifestSourceFor(
      flags.from,
      this.container,
      readStdin,
      this.replacement(),
    );
    const result = await new Init(this.initDeps()).execute({
      dir: args.dir,
      source,
      name: flags.name,
      repos: flags['no-repos'] ? [] : flags.repos?.split(',').map((name) => name.trim()),
      adopt: flags.adopt,
      ...writeIntent(flags, this.posture),
      jobs: flags.jobs,
    });
    this.renderer.record(result);
  }
}
