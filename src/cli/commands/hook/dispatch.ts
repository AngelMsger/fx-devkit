import { Args, Flags } from '@oclif/core';

import { FxCommand } from '../../base.js';
import { hookMain } from '../../hook-entry.js';

export default class HookDispatchCommand extends FxCommand {
  static override description =
    'Dispatch a host lifecycle event; failures never fail the host session';
  static override hidden = true;
  static override args = {
    event: Args.string({ ignoreStdin: true, required: true, description: 'lifecycle event' }),
  };
  static override flags = {
    agent: Flags.string({ required: true, description: 'host agent' }),
    root: Flags.string({ description: 'bound workspace root' }),
    'fx-home': Flags.string({ description: 'bound fx home' }),
    owner: Flags.string({ description: 'managed entry identity' }),
  };
  async run(): Promise<void> {
    await hookMain(this.argv);
  }
}
