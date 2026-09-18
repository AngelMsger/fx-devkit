// Validate complete public service declarations and conflicting legacy variables.
import type { ProviderCatalog } from '../providers.js';
import type { ServiceField, ServiceSettings } from '../service.schema.js';
import type { Problem } from '../types.js';

// A member obtains their own credential and the flavor is probed, so neither has to
// be declared; every other accepted setting is part of a complete declaration.
const OPTIONAL: readonly ServiceField[] = ['credential_url', 'flavor'];

export interface ServiceRuleInput {
  // Undefined when the load path had no catalog: the checks that depend on a
  // provider's own declaration are skipped rather than guessed, and no provider is
  // reported as refusing settings fx simply could not look up.
  readonly providers: ProviderCatalog | undefined;
  readonly provider: string | undefined;
  readonly service: ServiceSettings | undefined;
  readonly vars: Readonly<Record<string, string>> | undefined;
  readonly path: string;
}

export function serviceRules(input: ServiceRuleInput): Problem[] {
  const { providers, service, vars, path } = input;
  if (!service) return [];
  const contract = providers?.find((provider) => provider.id === input.provider)?.settings;
  if (providers !== undefined && contract === undefined)
    return [{ path, message: 'provider does not support shared service configuration' }];
  const problems: Problem[] = [];
  for (const key of Object.keys(service) as ServiceField[]) {
    if (contract !== undefined && !contract.fields.includes(key))
      problems.push({ path: `${path}.${key}`, message: 'not supported by this provider' });
    if (vars?.[key] !== undefined && vars[key] !== service[key])
      problems.push({
        path: `${path}.${key}`,
        message: 'conflicts with the legacy variable; keep one shared source',
      });
  }
  if (contract === undefined) return problems;
  for (const key of contract.fields.filter((field) => !OPTIONAL.includes(field)))
    if (!service[key])
      problems.push({ path: `${path}.${key}`, message: 'required for service setup' });
  if (service.auth_scheme && !contract.authSchemes?.includes(service.auth_scheme))
    problems.push({
      path: `${path}.auth_scheme`,
      message: 'authentication method is not supported by this provider',
    });
  return problems;
}
