// Family CLIs own persistence and conflicts; fx supplies only public presets.
import type { ServiceSettings } from '../../domain/manifest/service.schema.js';
import type { ServiceDefinition } from '../../domain/setup/service.js';
import type { CommandDeadline, SetupRecipe } from '../../domain/setup/types.js';

export function familyService(
  tool: string,
  settings: ServiceSettings,
  minVersion: string,
  statusField = 'configured',
): ServiceDefinition {
  const context = settings.context?.toLowerCase() ?? '';
  const scope = serviceScope(settings);
  const browser = settings.auth_scheme === 'session' ? ['--browser'] : [];
  const preset = (flags: readonly string[]): string[] => [
    'config',
    'set-context',
    context,
    ...flags,
    '--format',
    'json',
  ];
  return {
    preparation: {
      kind: 'command',
      resource: context,
      minVersion,
      command: preset([...serviceFlags(settings), ...signInFlags(settings)]),
      agrees: preset(serviceFlags(settings)),
    },
    recipes: [
      reuseRecipe(tool, scope),
      {
        id: 'credential',
        tool,
        perEnv: false,
        kind: 'run',
        phase: 'authenticate',
        requires: ['reuse'],
        title: `Authenticate ${tool} with your own credentials`,
        instructions: `Each member obtains their own credentials. Run ${tool} ${scope.join(' ')} auth guide for acquisition instructions. No personal credential is distributed by the manifest.`,
        ...(settings.credential_url ? { open: settings.credential_url } : {}),
        run: [...scope, 'auth', 'login', ...browser],
        verify: {
          command: [...scope, 'auth', 'status', '--format', 'json'],
          json: { path: statusField, equals: true, reason: 'error' },
        },
      },
    ],
  };
}

// What pins one companion invocation to the declared service instead of the active context.
export function serviceScope(settings: ServiceSettings): string[] {
  return ['--use-context', settings.context?.toLowerCase() ?? '', ...serviceFlags(settings)];
}

type Settings = Readonly<Record<string, string | undefined>>;

// Where the service is. Setup, login and live query guards hold a context to this and to
// nothing else: a person who can reach the declared service is ready however they signed in.
export function serviceFlags(settings: Settings): string[] {
  return flagsOf(settings, ['base_url', 'flavor', 'org']);
}

// How a declaration proposes to sign in. It shapes a context fx creates and the sign-in
// fx offers; a context that already serves the declared service keeps its own.
export function signInFlags(settings: Settings): string[] {
  return flagsOf(settings, ['auth_scheme', 'credential_url']);
}

function flagsOf(settings: Settings, keys: readonly string[]): string[] {
  return keys.flatMap((key) =>
    settings[key] === undefined ? [] : [`--${key.replaceAll('_', '-')}`, settings[key]],
  );
}

// A companion bounds the lookups a reuse adds by ten seconds, or by a shorter `--timeout`.
// A lookup cut short still answers that nothing would change, which this check reads as
// passing, so the check is not asked with less than the full ten seconds.
const REUSE_DEADLINE: CommandDeadline = { flag: '--timeout', minimumMs: 10_000 };

function reuseRecipe(tool: string, scope: readonly string[]): SetupRecipe {
  return {
    id: 'reuse',
    tool,
    perEnv: false,
    kind: 'run',
    phase: 'prepare',
    title: `Reuse an existing ${tool} login`,
    instructions:
      'The companion matches and verifies existing credentials before associating their identity with the team context. No personal sign-in or secret export occurs.',
    run: [...scope, 'auth', 'reuse', '--format', 'json'],
    verify: {
      command: [...scope, 'auth', 'reuse', '--dry-run', '--format', 'json'],
      json: { path: 'changed', equals: false, unmet: 'an existing login can be reused' },
      deadline: REUSE_DEADLINE,
    },
  };
}
