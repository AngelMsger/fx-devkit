import { Flags } from '@oclif/core';

import { MEMBER_COLUMNS, MemberList } from '../../../application/member/list.js';
import { FxCommand } from '../../base.js';

import { scopeFlags } from './scope-flags.js';

export default class MemberListCommand extends FxCommand {
  static override description = 'List people by business scope, team, function and status';
  static override examples = ['<%= config.bin %> member list --area Platform'];
  static override flags = {
    ...scopeFlags,
    team: Flags.string({ description: 'team on the matching relationship' }),
    function: Flags.string({ description: 'function on the same relationship' }),
    status: Flags.string({
      description: 'only this status: active, initialized, resigned, deactivated',
    }),
  };

  async run(): Promise<void> {
    const { flags } = await this.parse(MemberListCommand);
    const rows = new MemberList(await this.workspaceDeps()).execute({
      ...flags,
      asOf: flags['as-of'],
    });
    this.renderer.list(rows, {
      columns: flags.team || flags.function ? [...MEMBER_COLUMNS, 'relationships'] : MEMBER_COLUMNS,
    });
  }
}
