// Resolve business selectors once per query. Each result carries the original
// evidence and interval from the single edge that satisfied all selectors.
import { DevkitError } from '../errors.js';
import { nearest, suggestionHint } from '../fuzzy.js';
import type { Members, Person } from '../manifest/types.js';

type Area = NonNullable<Members['areas']>[number];
type Scenario = NonNullable<Area['scenarios']>[number];
type Membership = NonNullable<Members['memberships']>[number];
type Assignment = NonNullable<Members['assignments']>[number];

export interface MemberScope {
  readonly area?: string | undefined;
  readonly scenario?: string | undefined;
  readonly asOf?: string | undefined;
}
export interface MemberFilter extends MemberScope {
  readonly team?: string | undefined;
  readonly function?: string | undefined;
  readonly status?: string | undefined;
}

function checkSelector(kind: string, value: string | undefined, choices: string[]): void {
  if (value === undefined || choices.includes(value)) return;
  throw new DevkitError(
    'not_found',
    `${kind.toUpperCase()}_NOT_FOUND`,
    `Unknown ${kind} "${value}"`,
    {
      hint: suggestionHint(
        nearest(value, choices),
        `Available ${kind} selectors: ${choices.join(', ') || '(none configured)'}.`,
      ),
      nextSteps: ['fx member list --help'],
    },
  );
}

function scopeOf(doc: Members, input: MemberFilter, today: string) {
  const areas = doc.areas ?? [];
  checkSelector(
    'area',
    input.area,
    areas.flatMap((a) => (a.id ? [a.id, a.group] : [a.group])),
  );
  const area = areas.find(
    (a) => input.area !== undefined && (a.id === input.area || a.group === input.area),
  );
  if (input.scenario && !area)
    throw new DevkitError('usage', 'SCENARIO_REQUIRES_AREA', '--scenario requires --area', {
      nextSteps: ['fx member list --help'],
    });
  const scenarios = area?.scenarios ?? [];
  checkSelector(
    'scenario',
    input.scenario,
    scenarios.map((s) => s.id ?? s.name),
  );
  const scenario = scenarios.find((s) => (s.id ?? s.name) === input.scenario);
  checkSelector(
    'team',
    input.team,
    (doc.teams ?? []).map((t) => t.id),
  );
  checkSelector(
    'function',
    input.function,
    (doc.functions ?? []).map((f) => f.id),
  );
  const asOf = input.asOf ?? today;
  const date = new Date(asOf + 'T00:00:00Z');
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(asOf) ||
    Number.isNaN(date.getTime()) ||
    !date.toISOString().startsWith(asOf + 'T')
  )
    throw new DevkitError('usage', 'INVALID_AS_OF', 'Expected a calendar date in YYYY-MM-DD form', {
      nextSteps: ['fx member show --help'],
    });
  return { area, scenario, asOf };
}

function responsibilities(areas: readonly Area[]) {
  return areas.flatMap((area) => {
    const areaId = area.id ?? area.group;
    const records = (person: string | undefined, role: string, scope: string | null) =>
      person === undefined ? [] : [{ person, role, area: areaId, scenario: scope }];
    return [
      ...records(area.lead, 'lead', null),
      ...(area.scenarios ?? []).flatMap((s) => {
        const id = s.id ?? s.name;
        return [
          ...records(s.dev_lead, 'dev_lead', id),
          ...Object.entries(s.roles ?? {}).flatMap(([role, people]) =>
            people.flatMap((p) => records(p, role, id)),
          ),
        ];
      }),
    ];
  });
}

function prepareView(doc: Members, input: MemberFilter, today: string) {
  const { area, scenario, asOf } = scopeOf(doc, input, today);
  const teamNames = new Map(doc.teams?.map((t) => [t.id, t.name]));
  const functionNames = new Map(doc.functions?.map((f) => [f.id, f.name]));
  const context = {
    area: area?.id ?? area?.group ?? null,
    scenario: scenario?.id ?? scenario?.name ?? null,
    as_of: asOf,
  };
  const applies = (r: Membership) =>
    (!r.valid_from || r.valid_from <= asOf) && (!r.valid_until || asOf < r.valid_until);
  const label = <T extends Membership>(r: T) => ({
    ...r,
    team_name: teamNames.get(r.team ?? '') ?? null,
    function_name: functionNames.get(r.function ?? '') ?? null,
  });
  const memberships = (doc.memberships ?? [])
    .filter(applies)
    .map((r) => ({ kind: 'membership' as const, ...label(r) }));
  const inScope = (r: Assignment) =>
    (!area || r.area === area.id) && (!scenario || !r.scenario || r.scenario === scenario.id);
  const activeAssignments = (doc.assignments ?? []).filter(applies);
  const assignments = activeAssignments
    .filter(inScope)
    .map((r) => ({ kind: 'assignment' as const, ...label(r) }));
  const allRoles = responsibilities(doc.areas ?? []);
  const roles = allRoles.filter(
    (r) =>
      (!area || r.area === context.area) &&
      (!scenario || r.scenario === null || r.scenario === context.scenario),
  );
  const collective = {
    roles: roles.filter((r) => r.person === 'all'),
    assignments: assignments.filter((r) => r.person === 'all'),
  };
  const responsibleTeams = (scope: Area | Scenario | undefined, level: string) =>
    (scope?.responsible_teams ?? []).map((team) => ({
      team,
      name: teamNames.get(team),
      level,
      scope: scope?.id,
    }));
  const owners = [...responsibleTeams(area, 'area'), ...responsibleTeams(scenario, 'scenario')];
  return {
    context,
    memberships,
    assignments,
    activeAssignments,
    roles,
    allRoles,
    owners,
    collective,
  };
}

type Facts = ReturnType<typeof prepareView>;

function classificationState(
  assignments: readonly Assignment[],
  configured: boolean,
  ambiguous: boolean,
) {
  if (ambiguous) return 'identity_ambiguous';
  const affiliations = assignments.filter((r) => r.team !== undefined);
  if (affiliations.some((r) => r.status === 'confirmed')) return 'confirmed';
  const candidates = new Set(
    affiliations.map((r) => JSON.stringify([r.team, r.function, r.area, r.scenario])),
  );
  if (candidates.size > 1) return 'multiple_candidates';
  if (candidates.size === 1) return 'candidate';
  return configured ? 'not_covered' : 'not_configured';
}

function describePerson(facts: Facts, id: string, configured: boolean, ambiguous: boolean) {
  const assignments = facts.assignments.filter((r) => r.person === id);
  return {
    context: facts.context,
    memberships: facts.memberships.filter((r) => r.person === id),
    responsible_teams: facts.owners,
    assignments,
    classification: classificationState(assignments, configured, ambiguous),
    legacy_roles: facts.roles.filter((r) => r.person === id),
    collective: facts.collective,
  };
}

function listPerson(doc: Members, facts: Facts, input: MemberFilter, person: Person) {
  const { memberships, assignments, roles, allRoles, context, activeAssignments } = facts;
  const matches = (r: Membership) =>
    (!input.team || r.team === input.team) && (!input.function || r.function === input.function);
  const personal = memberships.filter((r) => r.person === person.id);
  const collaboration = assignments.filter((r) => r.person === person.id);
  const relationships = [...(context.area !== null ? [] : personal), ...collaboration].filter(
    matches,
  );
  const legacy = roles.filter((r) => r.person === person.id);
  if (input.status && input.status !== (person.status ?? 'active')) return undefined;
  if ((input.team || input.function) && !relationships.length) return undefined;
  if (context.area !== null && !relationships.length && !legacy.length) return undefined;
  return {
    id: person.id,
    display: person.display ?? null,
    status: person.status ?? 'active',
    mentor: person.mentor ?? null,
    leader: person.leader ?? null,
    areas: (doc.areas ?? [])
      .filter(
        (a) =>
          allRoles.some((r) => r.person === person.id && r.area === (a.id ?? a.group)) ||
          activeAssignments.some((r) => r.person === person.id && r.area === a.id),
      )
      .map((a) => a.group),
    ...(doc.schema_version === 1 && !input.asOf && !input.scenario
      ? {}
      : { context, relationships }),
  };
}

export type MemberRow = NonNullable<ReturnType<typeof listPerson>>;
export type MemberClassification = ReturnType<typeof describePerson>;

interface MemberView {
  describe(id: string, ambiguous: boolean): MemberClassification;
  list(person: Person): MemberRow | undefined;
}

export function memberView(doc: Members, input: MemberFilter, today: string): MemberView {
  const facts = prepareView(doc, input, today);
  return {
    describe: (id, ambiguous) =>
      describePerson(facts, id, doc.assignments !== undefined, ambiguous),
    list: (person) => listPerson(doc, facts, input, person),
  };
}
