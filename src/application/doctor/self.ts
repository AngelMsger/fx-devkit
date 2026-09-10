// Doctor asks the registry now, not the cache: it is the one place a person
// comes to learn how things stand at this moment.

import { handoffEnvelope } from '../../domain/errors.js';
import { REGISTRY_HANDOFF } from '../self/registry.js';
import type { FxUpdateCheck, FxUpdateInput } from '../update/fx.js';

import { finding, type Finding } from './types.js';

export const NOT_CHECKED = 'not checked (update_check is off)';

export interface SelfCheck {
  readonly fx: FxUpdateCheck;
  readonly self: FxUpdateInput;
  readonly enabled: boolean;
}

export async function checkSelf(check: SelfCheck): Promise<Finding[]> {
  if (!check.enabled)
    return [
      finding('self', 'version', 'ok', `${check.self.current}; ${NOT_CHECKED}`, {
        coverage: 'not_applicable',
      }),
    ];
  const v = await check.fx.execute({ ...check.self, force: true });
  if (v.registry === null)
    return [
      finding(
        'self',
        'version',
        'warn',
        'The distribution registry is not configured for update checks.',
        { handoff: handoffEnvelope(REGISTRY_HANDOFF), coverage: 'incomplete' },
      ),
    ];
  if (v.source === 'skipped')
    return [
      finding('self', 'version', 'ok', `${v.current} is a development build; not checked`, {
        coverage: 'not_applicable',
      }),
    ];
  if (v.error !== undefined)
    return [
      finding('self', 'version', 'warn', `could not query the configured registry: ${v.error}`, {
        coverage: 'incomplete',
      }),
    ];
  if (v.behind)
    return [
      finding('self', 'version', 'warn', `${v.current} is behind ${v.latest ?? '?'}`, {
        fix: 'fx self update --yes',
      }),
    ];
  return [
    finding('self', 'version', 'ok', `${v.current} is the latest on the configured registry`),
  ];
}
