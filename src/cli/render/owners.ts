// The human face of `owners`: one block per scenario, people by name.

import type { Ownership, PersonRef } from '../../domain/members/owners.js';

export function ownerLines(value: unknown): string[] {
  if (value === null) return ['(no members document)'];
  const owners = value as readonly Ownership[];
  if (owners.length === 0) return ['(nobody)'];
  return owners.flatMap((o) => [
    `- ${o.area} / ${o.scenario}`,
    ...(o.lead === null ? [] : [`  area lead: ${person(o.lead)}`]),
    ...(o.devLead === null ? [] : [`  dev lead: ${person(o.devLead)}`]),
    ...Object.entries(o.roles).map(
      ([role, people]) => `  ${role}: ${people.map(person).join(', ')}`,
    ),
  ]);
}

function person(ref: PersonRef): string {
  const name = ref.name ?? ref.id;
  return ref.email === null ? name : `${name} (${ref.email})`;
}
