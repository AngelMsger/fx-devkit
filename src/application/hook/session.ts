// Resolves workspace hook settings and owns sync and doctor workflow policy.
import { asDevkitError, handoffEnvelope } from '../../domain/errors.js';
import { finding } from '../../domain/report.js';
import type { ConfigStore } from '../../ports/stores.js';
import { readSettings } from '../config/settings.js';
import type { DoctorExtension } from '../doctor/types.js';
import type { WritePosture } from '../safety/posture.js';
import type { StageResult } from '../sync/types.js';
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
): () => Promise<StageResult> {
  return async () => {
    const out = await manageHooks({ ...input, action: 'sync' });
    const summary: Record<string, number> = {};
    for (const item of out.items) summary[item.action] = (summary[item.action] ?? 0) + 1;
    return { summary, details: { items: out.items } };
  };
}

export function hookDoctor(input: HookSession): DoctorExtension {
  return {
    group: 'hooks',
    check: async () => {
      try {
        const out = await manageHooks({ ...input, action: 'inspect', dryRun: true });
        return out.items.map((item) => {
          const ok = ['disabled', 'unsupported', 'unchanged'].includes(item.action);
          return finding(
            'hooks',
            item.agent,
            ok ? 'ok' : 'warn',
            `${item.agent}: ${item.action}; native activation ${item.activation}`,
            { ...(ok ? {} : { fix: 'fx hook enable' }), handoff: item.handoff ?? undefined },
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
