// Event behavior is registered separately from host protocols. Every host
// reaches these same handlers; adding behavior requires no dispatch branch.

import { AutomaticSync } from '../application/hook/automatic-sync.js';
import type { HookRequest } from '../domain/harness/request.js';
import {
  describeSessionStart,
  shouldScheduleSessionStart,
} from '../domain/harness/session-start.js';
import type { HookHandler } from '../ports/hook-handler.js';

import type { Container } from './container.js';
import { createHookServices } from './hook-services.js';

interface BackgroundInput {
  readonly container: Container;
  readonly request: HookRequest;
  readonly env: NodeJS.ProcessEnv;
  readonly canWrite: () => Promise<boolean>;
}
interface HandlerRegistration {
  readonly handler: HookHandler;
  readonly background: (input: BackgroundInput) => Promise<void>;
}

export const lifecycleHandlers: Readonly<Record<string, HandlerRegistration>> = {
  'session-start': {
    handler: {
      shouldSchedule: shouldScheduleSessionStart,
      describe: (state, readOnly) => describeSessionStart({ state, readOnly }),
    },
    background: async (input) =>
      new AutomaticSync(await createHookServices(input)).execute({
        workspace: input.request.workspace,
        root: input.request.root,
      }),
  },
};

export function hookHandlers(): Readonly<Record<string, HookHandler>> {
  return Object.fromEntries(
    Object.entries(lifecycleHandlers).map(([event, entry]) => [event, entry.handler]),
  );
}
