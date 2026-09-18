import { EnvShow } from '../../../application/env/show.js';
import { FxCommand } from '../../base.js';
import { requiredArgument } from '../../flags.js';

export default class EnvShowCommand extends FxCommand {
  static override description =
    "One environment's platform matrix: provider, variables, confidence, notes";
  static override examples = ['<%= config.bin %> env show test'];
  static override args = {
    name: requiredArgument('environment name'),
  };
  static override flags = {};

  async run(): Promise<void> {
    const { args } = await this.parse(EnvShowCommand);
    this.renderer.record(new EnvShow(await this.workspaceDeps()).execute(args.name));
  }
}
