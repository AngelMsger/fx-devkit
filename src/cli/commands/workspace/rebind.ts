import { Args, Flags } from '@oclif/core';

import { manifestSourceFor } from '../../../composition/manifest-sources.js';
import { workspaceManagement } from '../../../composition/workspace-management.js';
import { FxCommand } from '../../base.js';
import { dryRunFlag } from '../../flags.js';
import { readStdin } from '../../stdin.js';

export default class WorkspaceRebind extends FxCommand {
  static override description =
    'Replace a registered manifest source with a validated staged source, preserving identity and local selections and retaining the previous source as a backup';
  static override args = {
    name: Args.string({
      ignoreStdin: true,
      required: true,
      description: 'registered workspace name',
    }),
  };
  static override flags = {
    from: Flags.string({
      required: true,
      description: 'new manifest Git URL, directory or - for stdin',
    }),
    'dry-run': dryRunFlag,
  };
  async run(): Promise<void> {
    const { args, flags } = await this.parse(WorkspaceRebind);
    const source = await manifestSourceFor(flags.from, this.container, readStdin);
    this.renderer.record(
      await workspaceManagement({
        ...this.harnessInput(),
        commandShell: this.commandShell,
      }).execute({
        name: args.name,
        action: 'rebind',
        source,
        dryRun: flags['dry-run'],
        posture: this.posture,
      }),
    );
  }
}
