import { Flags } from '@oclif/core';

import { MEMBER_COLUMNS, MemberList } from '../../../application/member/list.js';
import { FxCommand } from '../../base.js';

export default class MemberListCommand extends FxCommand {
  static override description = 'List people, optionally those of one area or one status';
  static override examples = ['<%= config.bin %> member list --area Platform'];
  static override flags = {
    area: Flags.string({ description: 'only people of this area' }),
    status: Flags.string({
      description: 'only this status: active, initialized, resigned, deactivated',
    }),
  };

  async run(): Promise<void> {
    const { flags } = await this.parse(MemberListCommand);
    const rows = new MemberList(await this.workspaceDeps()).execute({
      area: flags.area,
      status: flags.status,
    });
    this.renderer.list(rows, { columns: MEMBER_COLUMNS });
  }
}
