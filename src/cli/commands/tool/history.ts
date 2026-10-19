import { ToolHistory } from '../../../application/tool/history.js';
import { FxCommand } from '../../base.js';
import { argument } from '../../flags.js';

export default class ToolHistoryCommand extends FxCommand {
  static override description =
    'Read recorded tool installation attempts and outcomes across this FX_HOME, including tools removed from the manifest';
  static override examples = [
    '<%= config.bin %> tool history',
    '<%= config.bin %> tool history bitbucket-cli --format json',
  ];
  static override args = {
    tool: argument('filter by the recorded tool name'),
  };
  static override flags = {};

  async run(): Promise<void> {
    const { args } = await this.parse(ToolHistoryCommand);
    this.renderer.list(
      await new ToolHistory(this.container.toolHistory).execute({ name: args.tool }),
      {
        columns: [
          'at',
          'name',
          'operation',
          'installation_origin',
          'workspace',
          'via',
          'spec',
          'event',
          'code',
          'version_after',
          'failure_code',
        ],
        trailer: { scope: 'global' },
      },
    );
  }
}
