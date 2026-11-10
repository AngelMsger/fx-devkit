// Personal relationships reference real people, never collective business roles.
// Validate each graph separately: a mentor may legitimately share a student's owner.
import type { Members, Problem } from '../types.js';

export function personRelationshipRules(doc: Members): Problem[] {
  const problems: Problem[] = [];
  const people = new Map(doc.people.map((person) => [person.id, person]));
  for (const field of ['mentor', 'leader'] as const) {
    doc.people.forEach((person, index) => {
      const target = person[field];
      if (target === undefined) return;
      const path = `people[${index}].${field}`;
      if (target === 'all' || !people.has(target)) {
        problems.push({ path, message: 'must reference a person in this document' });
        return;
      }
      if (target === person.id) {
        problems.push({ path, message: 'must not reference the same person' });
        return;
      }
      const visited = new Set([person.id]);
      let current: string | undefined = target;
      while (current !== undefined && !visited.has(current)) {
        visited.add(current);
        current = people.get(current)?.[field];
      }
      if (current !== undefined)
        problems.push({ path, message: `${field} relationships must not contain a cycle` });
    });
  }
  return problems;
}
