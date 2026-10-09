// The human face of `owners`: one block per scenario, people by name.

import type { Ownership, PersonRef } from '../../domain/members/owners.js';

import type { Display } from './display.js';

export function ownerLines(value: unknown, display: Display): string[] {
  if (value === null) return [display.paint('quiet', '(no members document)')];
  const owners = value as readonly Ownership[];
  if (owners.length === 0) return [display.paint('quiet', '(nobody)')];
  const role = (name: string, people: string): string =>
    `  ${display.paint('quiet', `${name}:`)} ${people}`;
  return owners.flatMap((o) => [
    `${display.paint('quiet', '-')} ${o.area} / ${o.scenario}`,
    ...(o.lead === null ? [] : [role('area lead', person(o.lead))]),
    ...(o.devLead === null ? [] : [role('dev lead', person(o.devLead))]),
    ...Object.entries(o.roles).map(([name, people]) => role(name, people.map(person).join(', '))),
  ]);
}

function person(ref: PersonRef): string {
  const name = ref.name ?? ref.id;
  return ref.email === null ? name : `${name} (${ref.email})`;
}
