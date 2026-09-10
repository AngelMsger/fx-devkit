// Trust on first use: a command vector from the manifest is identified by the hash of
// its exact arguments, so changing one argument is a new vector that has to be confirmed
// again.

import { createHash } from 'node:crypto';

export function fingerprint(vector: readonly string[]): string {
  return createHash('sha256').update(JSON.stringify(vector)).digest('hex');
}

export function renderVector(vector: readonly string[]): string {
  return vector.map((arg) => (/[\s"']/.test(arg) ? JSON.stringify(arg) : arg)).join(' ');
}

export interface TrustExecution {
  readonly purpose: string;
  readonly resource: string;
  readonly bindings: Readonly<Record<string, string>>;
}
export interface TrustIdentity {
  readonly vector: readonly string[];
  readonly execution?: TrustExecution | undefined;
}

export function trustFingerprint(input: TrustIdentity): string {
  if (!input.execution) return fingerprint(input.vector);
  const { purpose, resource, bindings } = input.execution;
  return createHash('sha256')
    .update(
      JSON.stringify({
        version: 1,
        vector: input.vector,
        purpose,
        resource,
        bindings: Object.entries(bindings).sort(([a], [b]) => a.localeCompare(b)),
      }),
    )
    .digest('hex');
}

export function renderTrustContext(execution: TrustExecution | undefined): string {
  if (!execution) return '';
  return `\nContext: ${execution.purpose} ${execution.resource}\nEnvironment references: ${JSON.stringify(execution.bindings)}`;
}
