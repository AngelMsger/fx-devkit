// Shared service settings are an allowlist of public connection metadata.
// Personal identities and credentials are never part of this document.
import * as z from 'zod';

const publicUrl = z.string().refine((value) => {
  try {
    const url = new URL(value);
    return (
      ['http:', 'https:'].includes(url.protocol) &&
      !url.username &&
      !url.password &&
      !url.search &&
      !url.hash &&
      !/[\r\n]/.test(value)
    );
  } catch {
    return false;
  }
}, 'must be an absolute HTTP(S) URL without credentials, query or fragment');

const identifier = z
  .string()
  .min(1)
  .regex(/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/);

export const serviceSchema = z
  .strictObject({
    base_url: publicUrl.optional().describe('public service URL; never include credentials'),
    context: identifier.optional().describe('explicit companion context name'),
    flavor: z
      .enum(['cloud', 'datacenter', 'auto'])
      .optional()
      .describe('service deployment flavor'),
    org: identifier.optional().describe('shared organization slug'),
    auth_scheme: z
      .enum(['none', 'pat', 'basic', 'token', 'bearer', 'session'])
      .optional()
      .describe(
        'authentication method only, `none` where the service takes no sign-in; each member obtains their own credential',
      ),
    credential_url: publicUrl
      .optional()
      .describe('public page explaining where members obtain credentials'),
  })
  .describe(
    'shared service settings only; usernames, tokens, passwords and sessions are forbidden',
  );

export type ServiceSettings = z.infer<typeof serviceSchema>;
export type ServiceField = keyof ServiceSettings;
export type AuthScheme = NonNullable<ServiceSettings['auth_scheme']>;

export function serviceVars(service: ServiceSettings | undefined): Record<string, string> {
  if (!service) return {};
  const values: Record<string, string> = Object.fromEntries(
    Object.entries(service).filter(
      (entry): entry is [string, string] => typeof entry[1] === 'string',
    ),
  );
  if (service.base_url) {
    values['host'] = new URL(service.base_url).host;
    values['web'] = service.base_url.replace(/\/+$/, '');
  }
  return values;
}
