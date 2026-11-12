import { Flags } from '@oclif/core';

import { MemberSelectors } from '../../../application/member/selectors.js';
import type { SelectorKind } from '../../../domain/members/selectors.js';
import { FxCommand } from '../../base.js';

export default class MemberSelectorsCommand extends FxCommand {
  static override description =
    'List exact area, scenario, team and function selectors without people';
  static override examples = ['<%= config.bin %> member selectors --kind scenario --format json'];
  static override flags = {
    kind: Flags.string({
      options: ['area', 'scenario', 'team', 'function'],
      description: 'only this kind of selector',
    }),
  };

  async run(): Promise<void> {
    const { flags } = await this.parse(MemberSelectorsCommand);
    const rows = new MemberSelectors(await this.workspaceDeps()).execute({
      kind: flags.kind as SelectorKind | undefined,
    });
    this.renderer.list(rows, { columns: ['kind', 'id', 'name', 'area'] });
  }
}
