// The three hook commands differ only in the action they ask for; what they
// report about the workspace projection is one view.

import { manageHooks } from '../application/hook/session.js';
import { HOOK_COLUMNS } from '../application/hook/types.js';
import type { ReconcileInput } from '../application/hook/types.js';
import { hookSession } from '../composition/hooks.js';

import { FxCommand } from './base.js';

interface DryRunFlag {
  readonly 'dry-run': boolean;
}

export abstract class HookCommand extends FxCommand {
  protected async reconcile(action: ReconcileInput['action'], dryRun: boolean): Promise<void> {
    const out = await manageHooks({
      ...hookSession({
        container: this.container,
        resolve: this.resolveInput(),
        env: process.env,
        posture: this.posture,
      }),
      action,
      dryRun,
    });
    this.renderer.list(out.items, {
      columns: HOOK_COLUMNS,
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
