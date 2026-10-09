import { Flags } from '@oclif/core';

import { CAPABILITY_COLUMNS, Can } from '../../application/can.js';
import { canMcp } from '../../application/harness/session.js';
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
    if (args.target === undefined) {
      const can = new Can(await this.workspaceDeps(), this.loginDeps());
      this.renderer.list(can.list({ agent: flags.agent, env: flags.env }), {
        columns: CAPABILITY_COLUMNS,
      });
      return;
    }
    if (args.target.startsWith('mcp:')) {
      this.renderer.record(
        await canMcp({
          ...harnessSession(this.harnessInput()),
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
