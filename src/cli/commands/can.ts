import { Flags } from '@oclif/core';

import { CAPABILITY_COLUMNS, Can, canTarget } from '../../application/readiness/can.js';
import { harnessSession } from '../../composition/harness.js';
import { FxCommand } from '../base.js';
import { argument } from '../flags.js';

export default class CanCommand extends FxCommand {
  static override description =
    'Whether a capability or tool can be used right now; when not, what a person must do first\n\nWithout a target, list every capability a manifest binds and what serves it in this workspace. The list reads bindings only; it does not check readiness.';
  static override examples = [
    '<%= config.bin %> can --format json',
    '<%= config.bin %> can log-store --env test --format json',
    '<%= config.bin %> can cluster --env test',
    '<%= config.bin %> can bitbucket-cli',
  ];
  static override args = {
    target: argument('a capability (e.g. log-store) or a tool name; omit to list capabilities'),
  };
  static override flags = {
    agent: Flags.string({ description: 'the host for an mcp:<name> resource' }),
    env: Flags.string({
      description: 'the environment; required for environment-scoped capabilities',
    }),
  };

  async run(): Promise<void> {
    const { args, flags } = await this.parse(CanCommand);
    const workspace = async (): Promise<Can> =>
      new Can(await this.workspaceDeps(), this.loginDeps());
    if (args.target === undefined) {
      const rows = (await workspace()).list({ agent: flags.agent, env: flags.env });
      this.renderer.list(rows, { columns: CAPABILITY_COLUMNS });
      return;
    }
    this.renderer.record(
      await canTarget(
        { target: args.target, agent: flags.agent, env: flags.env },
        { workspace, harness: () => harnessSession(this.harnessInput()) },
      ),
    );
  }
}
