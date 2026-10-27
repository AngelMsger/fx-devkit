import { Args, Flags } from '@oclif/core';

import { Init } from '../../application/init/index.js';
import { ResumeInit } from '../../application/init/resume.js';
import { StandaloneInit } from '../../application/init/standalone.js';
import { manifestSourceFor, resumeInitDeps } from '../../composition/manifest-sources.js';
import { DevkitError } from '../../domain/errors.js';
import { FxCommand } from '../base.js';
import { dryRunFlag, jobsFlag, writeIntent } from '../flags.js';
import { readStdin } from '../stdin.js';

export default class InitCommand extends FxCommand {
  static override description =
    "Prepare a workspace from a manifest, set up companion tools without one, or continue unfinished preparation\n\nProvide a directory and source. fx prepares the selected repositories, local tools and Agent guides, then verifies the result. Only local prepare steps execute automatically, even with --yes; personal sign-in is a handoff. Read preparation.next for the next decision. After completing them, use init --resume --workspace <name>. Existing user files and completed work are preserved.\n\nWithout a directory and source, init sets up companion tools on this machine instead: the ones --tools names, or the ones a person picks from the catalog. fx installs the missing ones and their Skills, checks each sign-in, and on a terminal offers to start a tool's own setup, which asks for the service and the person's credentials.";
  static override examples = [
    '<%= config.bin %> init ~/Workspaces/fx --from ssh://git@git.example.com/team/workspace-manifest.git',
    '<%= config.bin %> init ./ws --from ./manifest --repos api --dry-run',
    '<%= config.bin %> init --resume --workspace ws',
    'cat workspace.yaml | <%= config.bin %> init ./ws --from -',
    '<%= config.bin %> init   # pick companion tools to set up on this machine',
    '<%= config.bin %> init --tools bitbucket-cli,jira-cli --dry-run',
  ];
  static override args = {
    dir: Args.string({ description: 'directory to prepare; omitted with --resume' }),
  };
  static override flags = {
    resume: Flags.boolean({
      description: 'continue a registered workspace without reimporting its source',
      exclusive: ['from', 'name', 'repos', 'no-repos', 'tools'],
    }),
    tools: Flags.string({
      exclusive: ['from', 'name', 'repos', 'no-repos'],
      description:
        'without a manifest: comma-separated catalog tools to set up on this machine, or all; a terminal asks when omitted',
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
    const intent = writeIntent(flags, this.posture);
    const forWorkspace =
      [flags.from, flags.name, flags.repos].some((value) => value !== undefined) ||
      flags['no-repos'];
    if (!flags.resume && !args.dir && !forWorkspace) {
      const result = await new StandaloneInit(this.standaloneInitDeps()).execute({
        tools: flags.tools?.split(',').map((name) => name.trim()),
        interactive: !this.noInput,
        yes: this.yes,
        cwd: process.cwd(),
        ...intent,
      });
      await this.renderPreparation(result);
      return;
    }
    const run = { ...intent, jobs: flags.jobs };
    if (!flags.resume && (!args.dir || !flags.from || flags.tools !== undefined))
      throw new DevkitError(
        'usage',
        'INIT_INPUT_REQUIRED',
        flags.tools === undefined
          ? 'Choose a workspace directory and manifest source'
          : '--tools sets up this machine and takes no directory',
        { nextSteps: ['fx init <directory> --from <source>', 'fx init --tools <name,...>'] },
      );
    this.foldRestatedOutcomes();
    if (flags.resume) {
      const deps = resumeInitDeps(this.initDeps(), this.container);
      const resumed = { workspace: flags.workspace!, cwd: process.cwd(), ...run };
      await this.renderPreparation(await new ResumeInit(deps).execute(resumed));
      return;
    }
    const source = await manifestSourceFor(
      flags.from!,
      this.container,
      readStdin,
      this.replacement(),
    );
    const result = await new Init(this.initDeps()).execute({
      dir: args.dir!,
      source,
      name: flags.name,
      repos: flags['no-repos'] ? [] : flags.repos?.split(',').map((name) => name.trim()),
      adopt: flags.adopt,
      ...run,
    });
    await this.renderPreparation(result);
  }
}
