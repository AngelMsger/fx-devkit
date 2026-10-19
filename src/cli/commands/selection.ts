// The six commands that edit a personal selection. They differ in the
// collection, the operation and their prose; parsing, the write gate and the
// recorded answer are one. Their strict, args and flags stay on each command:
// the parser copies a command's own static members and drops inherited ones.

import { Flags, type Interfaces } from '@oclif/core';

import type { WorkspaceDeps } from '../../application/workspace/deps.js';
import type {
  ScopeOperation,
  ScopeOutput,
  ScopeSelection,
} from '../../application/workspace/scope.js';
import { FxCommand } from '../base.js';
import { dryRunFlag, writeIntent } from '../flags.js';

type ScopeEditor = (
  deps: WorkspaceDeps,
  input: ScopeSelection,
  operation: ScopeOperation,
) => Promise<ScopeOutput>;

// --all and --none each replace the whole selection, so they exclude each other.
export function selectFlags(collection: string): {
  all: Interfaces.BooleanFlag<boolean>;
  none: Interfaces.BooleanFlag<boolean>;
  'dry-run': Interfaces.BooleanFlag<boolean>;
} {
  return {
    all: Flags.boolean({
      exclusive: ['none'],
      description: 'follow all shared declarations, including future additions',
    }),
    none: Flags.boolean({ exclusive: ['all'], description: `select no shared ${collection}` }),
    'dry-run': dryRunFlag,
  };
}

export abstract class SelectionCommand extends FxCommand {
  protected async editSelection(
    edit: ScopeEditor,
    operation: ScopeOperation,
    argv: readonly unknown[],
    flags: { readonly 'dry-run': boolean },
  ): Promise<void> {
    const result = await edit(
      await this.workspaceDeps(),
      // A non-strict command's argv is typed unknown; its declared argument is a string.
      { names: argv as readonly string[], ...writeIntent(flags, this.posture) },
      operation,
    );
    this.renderer.record(result);
  }
}
