// Family CLIs own persistence and conflicts; fx supplies only public presets.
import type { ServiceSettings } from '../../domain/manifest/service.schema.js';
import type { ServiceDefinition } from '../../domain/setup/service.js';
import type { SetupRecipe } from '../../domain/setup/types.js';

export function familyService(
  tool: string,
  settings: ServiceSettings,
  minVersion: string,
  statusField = 'configured',
): ServiceDefinition {
  const flags = serviceFlags(settings);
  const scope = serviceScope(settings);
  const browser = settings.auth_scheme === 'session' ? ['--browser'] : [];
  return {
    preparation: {
      kind: 'command',
      resource: settings.context?.toLowerCase() ?? '',
      minVersion,
      command: [
        'config',
        'set-context',
        settings.context?.toLowerCase() ?? '',
        ...flags,
        '--format',
        'json',
      ],
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
          json: { path: statusField, equals: true },
        },
      },
    ],
  };
}

// What pins one companion invocation to the declared service instead of the active context.
export function serviceScope(settings: ServiceSettings): string[] {
  return ['--use-context', settings.context?.toLowerCase() ?? '', ...serviceFlags(settings, false)];
}

// The same public-field selection is used by setup, login and live query guards.
export function serviceFlags(
  settings: Readonly<Record<string, string | undefined>>,
  includeGuide = true,
): string[] {
  const keys = [
    'base_url',
    'flavor',
    'org',
    'auth_scheme',
    ...(includeGuide ? ['credential_url'] : []),
  ];
  return keys.flatMap((key) =>
    settings[key] === undefined ? [] : [`--${key.replaceAll('_', '-')}`, settings[key]],
  );
}

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
      json: { path: 'changed', equals: false },
    },
  };
}
