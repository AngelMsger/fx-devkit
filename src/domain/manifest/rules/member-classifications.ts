// Schema 2 adds stable business selectors and dated, evidence-backed edges.
// Check references by scope so a scenario in another area cannot satisfy an assignment.
import { atLeast } from '../../semver.js';
import type { Members, Problem } from '../types.js';

export function classificationRules(doc: Members): Problem[] {
  const problems: Problem[] = [];
  const add = (path: string, message: string): void => {
    problems.push({ path, message });
  };
  const register = (set: Set<string>, id: string, path: string): void => {
    if (set.has(id)) add(path, 'duplicate identifier');
    set.add(id);
  };
  const areas = doc.areas ?? [];
  if (doc.schema_version === 1) {
    checkLegacy(doc, add);
    return problems;
  }
  if (!atLeast(doc.min_cli ?? '', '0.16.0'))
    add('min_cli', 'members schema 2 requires a floor of at least 0.16.0');
  const teams = new Set<string>();
  const functions = new Set<string>();
  doc.teams?.forEach((entry, i) => register(teams, entry.id, `teams[${i}].id`));
  doc.functions?.forEach((entry, i) => register(functions, entry.id, `functions[${i}].id`));
  const people = new Set(doc.people.map((p) => p.id));
  doc.people.forEach((p, i) => {
    if (p.id === 'all') add(`people[${i}].id`, 'reserved collective id');
  });
  const areaSelectors = new Set<string>();
  const scenariosByArea = new Map<string, Set<string>>();
  const checkScope = (
    scope: { id?: string | undefined; responsible_teams?: string[] | undefined },
    path: string,
    ids: Set<string>,
  ): void => {
    if (!scope.id) add(`${path}.id`, 'required in members schema 2');
    else register(ids, scope.id, `${path}.id`);
    const seen = new Set<string>();
    scope.responsible_teams?.forEach((team, i) => {
      const at = `${path}.responsible_teams[${i}]`;
      if (!teams.has(team)) add(at, 'unknown team id');
      register(seen, team, at);
    });
  };
  areas.forEach((area, i) => {
    const at = `areas[${i}]`;
    checkScope(area, at, areaSelectors);
    if (area.group !== area.id) register(areaSelectors, area.group, `${at}.group`);
    const scenarios = new Set<string>();
    if (area.id) scenariosByArea.set(area.id, scenarios);
    area.scenarios?.forEach((s, j) => checkScope(s, `${at}.scenarios[${j}]`, scenarios));
  });
  checkRelationships(doc, { people, teams, functions, scenariosByArea }, add);
  return problems;
}

type Report = (path: string, message: string) => void;
interface Vocabulary {
  people: Set<string>;
  teams: Set<string>;
  functions: Set<string>;
  scenariosByArea: Map<string, Set<string>>;
}

function checkLegacy(doc: Members, add: Report): void {
  for (const key of ['teams', 'functions', 'memberships', 'assignments'] as const)
    if (doc[key] !== undefined) add(key, 'requires members schema 2');
  doc.areas?.forEach((area, i) => {
    for (const [path, scope] of [
      [`areas[${i}]`, area] as const,
      ...(area.scenarios ?? []).map((s, j) => [`areas[${i}].scenarios[${j}]`, s] as const),
    ])
      for (const key of ['id', 'responsible_teams'] as const)
        if (scope[key] !== undefined) add(`${path}.${key}`, 'requires members schema 2');
  });
}

function checkRelationships(doc: Members, vocabulary: Vocabulary, add: Report): void {
  const { people, teams, functions, scenariosByArea } = vocabulary;
  for (const kind of ['memberships', 'assignments'] as const) {
    const seen = new Set<string>();
    doc[kind]?.forEach((r, i) => {
      const at = `${kind}[${i}]`;
      if (!people.has(r.person) && !(kind === 'assignments' && r.person === 'all'))
        add(`${at}.person`, 'unknown person id');
      if (r.person === 'all' && !r.team)
        add(`${at}.team`, 'a collective assignment needs an explicit team');
      if (!r.team && !r.function) add(at, 'declare a team or function');
      if (r.team && !teams.has(r.team)) add(`${at}.team`, 'unknown team id');
      if (r.function && !functions.has(r.function)) add(`${at}.function`, 'unknown function id');
      if (r.status === 'confirmed' && !r.verified_at)
        add(`${at}.verified_at`, 'required for a confirmed relationship');
      if (r.valid_from && r.valid_until && r.valid_from >= r.valid_until)
        add(`${at}.valid_until`, 'must follow valid_from');
      const scope = kind === 'assignments' ? doc.assignments?.[i] : undefined;
      if (scope && !scenariosByArea.has(scope.area)) add(`${at}.area`, 'unknown area id');
      if (scope?.scenario && !scenariosByArea.get(scope.area)?.has(scope.scenario))
        add(`${at}.scenario`, 'unknown scenario in this area');
      const key = JSON.stringify([
        r.person,
        r.team,
        r.function,
        scope?.area,
        scope?.scenario,
        r.valid_from,
        r.valid_until,
      ]);
      if (seen.has(key)) add(at, 'duplicate relationship for the same validity interval');
      seen.add(key);
    });
  }
}
