import { Args } from '@oclif/core';

import { FxCommand } from '../../base.js';

export default class ToolHistoryCommand extends FxCommand {
  static override description =
    'Read recorded tool installation attempts and outcomes across this FX_HOME, including tools removed from the manifest';
  static override examples = [
    '<%= config.bin %> tool history',
    '<%= config.bin %> tool history bitbucket-cli --format json',
  ];
  static override args = {
    tool: Args.string({ ignoreStdin: true, description: 'filter by the recorded tool name' }),
  };
  static override flags = {};

  async run(): Promise<void> {
    const { args } = await this.parse(ToolHistoryCommand);
    const history = await this.container.toolHistory.read();
    this.renderer.list(
      history.filter((entry) => args.tool === undefined || entry.name === args.tool),
      {
        columns: [
          'at',
          'name',
          'operation',
          'workspace',
          'via',
          'spec',
          'event',
          'code',
          'version_after',
          'failure_code',
        ],
      },
    );
  }
}
