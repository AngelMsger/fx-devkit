import { Flags } from '@oclif/core';

import { MemberShow, PERSON_COLUMNS } from '../../../application/member/show.js';
import { FxCommand } from '../../base.js';
import { requiredArgument } from '../../flags.js';

import { scopeFlags } from './scope-flags.js';

export default class MemberShowCommand extends FxCommand {
  static override description =
    'Who a name refers to: by email, id, an account in any system, display name or git author name';
  static override examples = [
    '<%= config.bin %> member show alice',
    '<%= config.bin %> member show ou_alice --format json',
  ];
  static override args = {
    query: requiredArgument('email, id, account handle, name or git name'),
  };
  static override flags = {
    ...scopeFlags,
    system: Flags.string({ description: 'resolve an account in this system only' }),
  };

  async run(): Promise<void> {
    const { args, flags } = await this.parse(MemberShowCommand);
    const rows = new MemberShow(await this.workspaceDeps()).execute(args.query, {
      ...flags,
      asOf: flags['as-of'],
    });
    this.renderer.list(rows, {
      columns: PERSON_COLUMNS,
    });
  }
}
