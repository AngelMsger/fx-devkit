// The three hook commands differ only in the action they ask for; what they
// report about the workspace projection is one view.

import { HARNESS_COLUMNS } from '../application/harness/types.js';
import type { ReconcileInput } from '../application/hook/reconcile.js';
import { manageHooks } from '../composition/hooks.js';

import { FxCommand } from './base.js';

interface DryRunFlag {
  readonly 'dry-run': boolean;
}

export abstract class HookCommand extends FxCommand {
  static override announcesSkill = false;

  protected async reconcile(action: ReconcileInput['action'], dryRun: boolean): Promise<void> {
    const out = await manageHooks({
      container: this.container,
      resolve: this.resolveInput(),
      env: process.env,
      action,
      posture: this.posture,
      dryRun,
    });
    this.renderer.list(out.items, {
      columns: HARNESS_COLUMNS,
      trailer: {
        workspace: out.workspace,
        root: out.root,
        enabled: out.enabled,
        observations: out.state?.observations ?? [],
      },
    });
  }
}

export abstract class HookProjectionCommand extends HookCommand {
  protected abstract readonly action: 'inject' | 'remove';

  async run(): Promise<void> {
    const { flags } = await this.parse<DryRunFlag, DryRunFlag, object>();
    await this.reconcile(this.action, flags['dry-run']);
  }
}
