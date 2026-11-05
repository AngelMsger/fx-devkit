// Ambiguity is a lint finding, never a reason to reject an existing directory.
// Report record positions only. A state without a handle identifies nobody.
import type { LintFinding } from '../manifest/lint.js';
import type { Members } from '../manifest/types.js';

interface Handle {
  readonly value: string;
  readonly opaque: boolean;
  readonly person: number;
}

export function accountCollisions(doc: Members): LintFinding[] {
  const systems = new Map<string, Map<string, Handle[]>>();
  const findings: LintFinding[] = [];
  doc.people.forEach((p, person) => {
    for (const [system, account] of Object.entries(p.accounts ?? {})) {
      const buckets = systems.get(system) ?? new Map<string, Handle[]>();
      systems.set(system, buckets);
      const { username, id } =
        typeof account === 'string' ? { username: account, id: undefined } : account;
      const shared = new Set<number>();
      for (const [value, opaque] of [
        [username, false],
        [id, true],
      ] as const) {
        if (value === undefined) continue;
        const key = value.toLowerCase();
        const previous = buckets.get(key) ?? [];
        for (const h of previous) {
          if (
            h.person !== person &&
            (!opaque || !h.opaque || h.value === value || doc.schema_version === 1)
          )
            shared.add(h.person);
        }
        previous.push({ value, opaque, person });
        buckets.set(key, previous);
      }
      for (const first of shared)
        findings.push({
          kind: 'members',
          code: 'AMBIGUOUS_ACCOUNT',
          path: `people[${person}].accounts`,
          message: `A handle in the same system also matches people[${first}].`,
        });
    }
  });
  return findings;
}
