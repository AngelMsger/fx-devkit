import { Args, Flags } from '@oclif/core';

import { Can } from '../../application/can.js';
import { canMcp } from '../../composition/harness.js';
import { FxCommand } from '../base.js';

export default class CanCommand extends FxCommand {
  static override description =
    'Whether a capability or tool can be used right now; when not, what a person must do first';
  static override examples = [
    '<%= config.bin %> can log-store --env test --format json',
    '<%= config.bin %> can cluster --env test',
    '<%= config.bin %> can bitbucket-cli',
  ];
  static override args = {
    target: Args.string({
      required: true,
      description: 'a capability (e.g. log-store) or a tool name',
    }),
  };
  static override flags = {
    agent: Flags.string({ description: 'the host for an mcp:<name> resource' }),
    env: Flags.string({
      description: 'the environment; required for environment-scoped capabilities',
    }),
  };

  async run(): Promise<void> {
    const { args, flags } = await this.parse(CanCommand);
    if (args.target.startsWith('mcp:')) {
      this.renderer.record(
        await canMcp({
          ...this.harnessInput(),
          name: args.target.slice(4),
          agent: flags.agent,
          envName: flags.env,
        }),
      );
      return;
    }
    const result = await new Can(await this.workspaceDeps(), this.loginDeps()).execute({
      target: args.target,
      agent: flags.agent,
      env: flags.env,
    });
    this.renderer.record(result);
  }
}
