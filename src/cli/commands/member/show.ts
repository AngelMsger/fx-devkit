import { Args } from '@oclif/core';

import { MemberShow } from '../../../application/member/show.js';
import { FxCommand } from '../../base.js';

export default class MemberShowCommand extends FxCommand {
  static override description =
    'Who a name refers to: by email, id, an account in any system, display name or git author name';
  static override examples = [
    '<%= config.bin %> member show alice',
    '<%= config.bin %> member show ou_alice --format json',
  ];
  static override args = {
    query: Args.string({
      ignoreStdin: true,
      required: true,
      description: 'email, id, account handle, name or git name',
    }),
  };
  static override flags = {};

  async run(): Promise<void> {
    const { args } = await this.parse(MemberShowCommand);
    const rows = new MemberShow(await this.workspaceDeps()).execute(args.query);
    this.renderer.list(rows, {
      columns: ['id', 'display', 'email', 'status', 'matched_by', 'via', 'accounts'],
    });
  }
}
