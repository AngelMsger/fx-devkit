// Schema negotiation. There is no embedded snapshot to fall back on, so every mismatch
// is fatal and the only cure is to upgrade fx or migrate the manifest. A development
// build of fx skips the version floor: it is newer than any release by definition.

import { DevkitError } from '../errors.js';
import { atLeast, isRelease, isSemver } from '../semver.js';

import type { Kind, Negotiation, NegotiationFailure } from './types.js';

export const SUPPORTED: Record<Exclude<Kind, 'local'>, readonly number[]> = {
  workspace: [1, 2],
  environments: [1, 2],
  tools: [3],
  harness: [2],
  members: [1],
};

export interface Header {
  readonly schema_version?: unknown;
  readonly min_cli?: unknown;
}

export function negotiate(
  header: Header,
  cliVersion: string,
  supported: readonly number[],
): Negotiation {
  const schema = Number.isInteger(header.schema_version)
    ? (header.schema_version as number)
    : undefined;
  const minCli = typeof header.min_cli === 'string' ? header.min_cli : undefined;
  return { schema, minCli, failure: failureOf(schema, minCli, cliVersion, supported) };
}

function failureOf(
  schema: number | undefined,
  minCli: string | undefined,
  cliVersion: string,
  supported: readonly number[],
): NegotiationFailure | undefined {
  if (schema === undefined) return undefined;
  if (schema < Math.min(...supported)) return 'schema_too_old';
  if (schema > Math.max(...supported)) return 'schema_too_new';
  if (
    minCli !== undefined &&
    isSemver(minCli) &&
    isRelease(cliVersion) &&
    !atLeast(cliVersion, minCli)
  )
    return 'cli_too_old';
  return undefined;
}

const UPGRADE_STEPS = ['fx self update --dry-run', 'fx --version'];

export function negotiationError(
  kind: Kind,
  n: Negotiation,
  cliVersion: string,
): DevkitError | undefined {
  if (n.failure === undefined) return undefined;
  const code = `MANIFEST_${n.failure.toUpperCase()}`;
  const message = {
    schema_too_old: `${kind} manifest uses schema version ${n.schema}, which fx ${cliVersion} no longer reads`,
    schema_too_new: `${kind} manifest uses schema version ${n.schema}, which fx ${cliVersion} does not understand yet`,
    cli_too_old: `${kind} manifest requires fx ${n.minCli} or newer, but this is ${cliVersion}`,
  }[n.failure];
  const nextSteps =
    n.failure === 'schema_too_old'
      ? [
          'Ask the manifest maintainers to migrate it to a supported schema version.',
          ...UPGRADE_STEPS,
        ]
      : UPGRADE_STEPS;
  const toolsMigration = kind === 'tools' && n.failure === 'schema_too_old';
  return new DevkitError('config', code, message, {
    hint: toolsMigration
      ? 'Use schema_version: 3 in tools.yaml. Each kind: run setup step needs phase: prepare for local non-interactive setup or phase: authenticate for personal sign-in.'
      : 'The manifest and this fx release disagree about the document format.',
    nextSteps: toolsMigration
      ? [
          'fx manifest schema --kind tools',
          'fx manifest explain --kind tools "tools[].setup[].phase"',
          'Update the source declaration and retry the original initialization.',
        ]
      : nextSteps,
  });
}
