// Resolves workspace hook settings and owns sync and doctor workflow policy.
import { asDevkitError, handoffEnvelope } from '../../domain/errors.js';
import { hookActionState } from '../../domain/harness/actions.js';
import { preparationCheck } from '../../domain/preparation.js';
import { finding } from '../../domain/report.js';
import { countBy } from '../../domain/values.js';
import type { ConfigStore } from '../../ports/stores.js';
import { readSettings } from '../config/settings.js';
import type { DoctorExtension } from '../doctor/types.js';
import type { WritePosture } from '../safety/posture.js';
import type { HookStageDetails, StageResult } from '../sync/types.js';
import { resolveWorkspace, type ResolveInput } from '../workspace/resolve.js';

import { ReconcileHooks } from './reconcile.js';
import type { HookDeps, HookOutput, ReconcileInput } from './types.js';

export interface HookSession {
  readonly deps: HookDeps;
  readonly config: ConfigStore;
  readonly resolve: ResolveInput;
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly posture: WritePosture;
}

export interface ManageHooksInput extends HookSession {
  readonly action: ReconcileInput['action'];
  readonly dryRun: boolean;
}

export async function manageHooks(input: ManageHooksInput): Promise<HookOutput> {
  const located = await resolveWorkspace(input.resolve);
  const settings = readSettings({ env: input.env, file: await input.config.read() });
  return new ReconcileHooks(input.deps).execute({
    workspace: located.name,
    root: located.root,
    action: input.action,
    posture: input.posture,
    dryRun: input.dryRun,
    globalEnabled: settings.hooks,
    configured: settings.agents,
  });
}

export function hookStage(
  input: HookSession & { readonly dryRun: boolean },
): () => Promise<StageResult<HookStageDetails>> {
  return async () => {
    const out = await manageHooks({ ...input, action: 'sync' });
    const summary = countBy(out.items, (item) => item.action);
    const projection = out.items.map((item) =>
      preparationCheck(
        `hook:${item.agent}:projection`,
        hookActionState(item.action),
        `${item.agent}: ${item.action}`,
        { required: false, owner: 'user' },
      ),
    );
    const activation = out.items
      .filter((item) => item.activation === 'unverified')
      .map((item) =>
        preparationCheck(
          `hook:${item.agent}:activation`,
          'unknown',
          item.handoff?.summary ?? 'Native activation has not been verified',
          { required: false, owner: 'user' },
        ),
      );
    return {
      summary,
      details: { items: out.items },
      checks: [...projection, ...activation],
      operationChecks: projection.map((check) => ({ ...check, required: true })),
    };
  };
}

export function hookDoctor(input: HookSession): DoctorExtension {
  return {
    group: 'hooks',
    check: async () => {
      try {
        const out = await manageHooks({ ...input, action: 'inspect', dryRun: true });
        return out.items.map((item) => {
          const ok = hookActionState(item.action) === 'skipped';
          return finding(
            'hooks',
            item.agent,
            ok ? 'ok' : 'warn',
            `${item.agent}: ${item.action}; native activation ${item.activation}`,
            {
              required: false,
              coverage: ok ? 'not_applicable' : 'incomplete',
              ...(ok ? {} : { fix: 'fx hook list' }),
              handoff: item.handoff ?? undefined,
            },
          );
        });
      } catch (err) {
        return [
          finding(
            'hooks',
            'metadata',
            'warn',
            `Hook inspection failed: ${asDevkitError(err).code}`,
            {
              coverage: 'incomplete',
              handoff: handoffEnvelope({
                summary: 'Hook metadata or configuration requires inspection',
                userSteps: [
                  {
                    id: 'hooks.metadata',
                    kind: 'manual',
                    title: 'Inspect hook metadata and foreign configuration',
                    instructions:
                      'Inspect the workspace hook metadata and reported configuration paths. Preserve user entries; retry after repairing the invalid data.',
                  },
                ],
                command: 'fx hook list',
              }),
            },
          ),
        ];
      }
    },
    fix: async (options) => {
      await manageHooks({
        ...input,
        action: 'sync',
        dryRun: options.dryRun,
        posture: options.posture,
      });
    },
  };
}
