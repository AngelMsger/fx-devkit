// Lifecycle definitions are host-neutral data. Hosts translate event names
// and output, while the single dispatch vector keeps behavior in fx.

import { DevkitError } from '../errors.js';

export type HookEvent = 'session-start' | 'stop';

export interface HookSpec {
  readonly event: HookEvent;
  readonly matcher?: string;
  readonly command: readonly string[];
  readonly background: boolean;
}

export interface HookSupport {
  readonly activationLimit?: string;
  readonly windowsCommand?: 'powershell' | 'override' | 'cmd';
  readonly projectPath: string;
  readonly protocol: string;
  readonly events: Readonly<Partial<Record<HookEvent, string>>>;
  readonly context: 'native' | 'bridge' | 'none';
  readonly identityEnvironment: readonly string[];
  readonly sessionKey?: string;
}

// A host names a protocol this fx has no implementation of.
export function hookProtocolUnsupported(): DevkitError {
  return new DevkitError(
    'config',
    'HOOK_PROTOCOL_UNSUPPORTED',
    'The lifecycle protocol is not available',
    {
      hint: 'This fx version does not implement the registered protocol.',
      nextSteps: ['fx self update'],
    },
  );
}

export interface HookInvocation {
  readonly cwd: string;
  readonly sessionId: string | null;
}

export const BUILTIN_HOOKS: readonly HookSpec[] = [
  {
    event: 'session-start',
    command: ['fx', 'hook', 'dispatch', 'session-start'],
    background: false,
  },
];
