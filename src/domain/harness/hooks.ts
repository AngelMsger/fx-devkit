// Lifecycle definitions are host-neutral data. Hosts translate event names
// and output, while the single dispatch vector keeps behavior in fx.

export type HookEvent = 'session-start' | 'stop';

export interface HookSpec {
  readonly event: HookEvent;
  readonly matcher?: string;
  readonly command: readonly string[];
  readonly background: boolean;
}

export interface HookSupport {
  readonly windowsCommand?: 'powershell' | 'override' | 'cmd';
  readonly projectPath: string;
  readonly protocol: string;
  readonly events: Readonly<Partial<Record<HookEvent, string>>>;
  readonly context: 'native' | 'bridge' | 'none';
  readonly identityEnvironment: readonly string[];
  readonly sessionKey?: string;
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
