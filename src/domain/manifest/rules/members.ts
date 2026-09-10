// Cross-field rules of the members document: ids are unique and every
// reference to a person resolves. The reserved id "all" means the whole
// team and is never listed under people.

import { isSemver } from '../../semver.js';
import type { Members, Problem } from '../types.js';

const ALL = 'all';

export function membersRules(doc: Members): Problem[] {
  const problems: Problem[] = [];
  if (doc.min_cli !== undefined && !isSemver(doc.min_cli)) {
    problems.push({ path: 'min_cli', message: 'must be a semantic version' });
  }
  const ids = new Map<string, number>();
  doc.people.forEach((person, i) => {
    const first = ids.get(person.id);
    if (first !== undefined)
      problems.push({ path: `people[${i}].id`, message: `duplicates people[${first}]` });
    else ids.set(person.id, i);
  });
  const check = (path: string, id: string | undefined): void => {
    if (id !== undefined && id !== ALL && !ids.has(id)) {
      problems.push({ path, message: `"${id}" is not a person in this document` });
    }
  };
  (doc.areas ?? []).forEach((area, a) => {
    check(`areas[${a}].lead`, area.lead);
    (area.scenarios ?? []).forEach((scenario, s) => {
      const at = `areas[${a}].scenarios[${s}]`;
      check(`${at}.dev_lead`, scenario.dev_lead);
      for (const [role, people] of Object.entries(scenario.roles ?? {})) {
        people.forEach((id, p) => check(`${at}.roles.${role}[${p}]`, id));
      }
    });
  });
  return problems;
}
