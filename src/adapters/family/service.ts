// Family CLIs own persistence and conflicts; fx supplies only public presets.
import type { ServiceSettings } from '../../domain/manifest/service.schema.js';
import type { ServiceDefinition } from '../../domain/setup/service.js';

export function familyService(
  tool: string,
  settings: ServiceSettings,
  statusField = 'configured',
  minVersion = '0.20.0',
): ServiceDefinition {
  const flags = serviceFlags(settings);
  const scope = [
    '--use-context',
    settings.context?.toLowerCase() ?? '',
    ...serviceFlags(settings, false),
  ];
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
      {
        id: 'credential',
        tool,
        perEnv: false,
        kind: 'run',
        phase: 'authenticate',
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
