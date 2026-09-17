// Validate complete public service declarations and conflicting legacy variables.
import type { ServiceSettings } from '../service.schema.js';
import type { Problem } from '../types.js';

const fields: Readonly<Record<string, readonly (keyof ServiceSettings)[]>> = {
  'bitbucket-cli': ['base_url', 'context', 'flavor', 'auth_scheme', 'credential_url'],
  confluence: ['base_url', 'context', 'flavor', 'auth_scheme', 'credential_url'],
  'jenkins-cli': ['base_url', 'context', 'auth_scheme', 'credential_url'],
  'openobserve-cli': ['base_url', 'context', 'org', 'auth_scheme', 'credential_url'],
  sentry: ['base_url', 'org'],
};

export function serviceRules(
  provider: string | undefined,
  service: ServiceSettings | undefined,
  vars: Readonly<Record<string, string>> | undefined,
  path: string,
): Problem[] {
  if (!service) return [];
  const allowed = fields[provider ?? ''];
  if (!allowed)
    return [{ path, message: 'provider does not support shared service configuration' }];
  const problems: Problem[] = [];
  for (const key of Object.keys(service) as (keyof ServiceSettings)[]) {
    if (!allowed.includes(key))
      problems.push({ path: `${path}.${key}`, message: 'not supported by this provider' });
    if (vars?.[key] !== undefined && vars[key] !== service[key])
      problems.push({
        path: `${path}.${key}`,
        message: 'conflicts with the legacy variable; keep one shared source',
      });
  }
  const required = allowed.filter((key) => key !== 'credential_url' && key !== 'flavor');
  for (const key of required)
    if (!service[key])
      problems.push({ path: `${path}.${key}`, message: 'required for service setup' });
  const schemes: Readonly<Record<string, readonly string[]>> = {
    'bitbucket-cli': ['pat', 'basic'],
    confluence: ['pat', 'basic'],
    'jenkins-cli': ['token', 'basic'],
    'openobserve-cli': ['basic', 'token', 'session'],
  };
  if (service.auth_scheme && !schemes[provider ?? '']?.includes(service.auth_scheme))
    problems.push({
      path: `${path}.auth_scheme`,
      message: 'authentication method is not supported by this provider',
    });
  return problems;
}
