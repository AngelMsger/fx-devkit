// manifest/members.yaml: people and their identifiers across systems. The document must
// say `sensitive: true` itself, so moving the file cannot quietly remove the protection.

import * as z from 'zod';

import { minCli, schemaVersion } from './common.schema.js';

export const STATUSES = ['active', 'initialized', 'resigned', 'deactivated'] as const;

export const account = z
  .union([
    z.string().describe('the handle in that system'),
    z.strictObject({
      username: z.string().optional().describe('the handle, where the system has one'),
      id: z
        .string()
        .optional()
        .describe('the opaque identifier, where the system uses one instead'),
      state: z
        .string()
        .optional()
        .describe('a deliberate negative such as not_found; distinct from having no entry at all'),
      verified: z.string().optional().describe('when this identifier was last checked'),
    }),
  ])
  .describe('what this person is called in one system');

export const personSchema = z
  .strictObject({
    id: z
      .string()
      .min(1)
      .describe('stable identifier, conventionally the local part of the email address'),
    display: z.string().optional().describe('the name to show, in whatever form the person uses'),
    email: z.string().optional().describe('corporate email address'),
    status: z
      .enum(STATUSES)
      .optional()
      .describe('active, initialized, resigned or deactivated; defaults to active'),
    accounts: z
      .record(z.string(), account)
      .optional()
      .describe('identifiers per system, keyed by system or provider id'),
    git_names: z
      .array(z.string())
      .optional()
      .describe(
        'author names seen in git history; used to resolve a commit to a person, never returned as an identifier',
      ),
  })
  .describe('one person');

const id = z.string().trim().min(1);
const definition = z.strictObject({
  id: id.describe('stable selector'),
  name: z.string().trim().min(1).describe('display name'),
});
const responsibility = {
  id: id.optional().describe('stable business selector, required in schema 2'),
  responsible_teams: z.array(id).optional().describe('teams explicitly responsible for this scope'),
};
const relation = {
  person: id.describe('person id; assignments alone also accept the collective "all"'),
  function: id.optional().describe('function performed in this relationship'),
  source: z.string().trim().min(1).describe('short evidence reference'),
  status: z.enum(['confirmed', 'unverified']).describe('confidence in this relationship'),
  verified_at: z.iso.date().optional().describe('date checked, required for confirmed evidence'),
  valid_from: z.iso.date().optional().describe('first applicable date, inclusive'),
  valid_until: z.iso.date().optional().describe('first inapplicable date, exclusive'),
};
const membership = z.strictObject({
  ...relation,
  team: id.optional().describe('directory team; omit for a standalone personal function'),
});
const assignment = z.strictObject({
  ...relation,
  team: id.optional().describe('collaborating team in this business scope, if evidenced'),
  area: id.describe('business area id'),
  scenario: id.optional().describe('limit applicability to this scenario id within the area'),
});

export const scenarioSchema = z
  .strictObject({
    ...responsibility,
    name: z.string().min(1).describe("the scenario's name"),
    dev_lead: z.string().optional().describe("person id of the scenario's development lead"),
    roles: z
      .record(z.string(), z.array(z.string()))
      .optional()
      .describe('role to person ids; the reserved id "all" means the whole team'),
    repos: z.array(z.string()).optional().describe('repositories implementing this scenario'),
  })
  .describe('one scenario within an area');

export const areaSchema = z
  .strictObject({
    ...responsibility,
    group: z.string().min(1).describe("the area's name"),
    lead: z.string().optional().describe("person id of the area's lead"),
    scenarios: z.array(scenarioSchema).optional().describe('the scenarios within this area'),
  })
  .describe('one area of ownership');

export const membersSchema = z
  .strictObject({
    schema_version: schemaVersion,
    min_cli: minCli,
    sensitive: z
      .literal(true)
      .describe('marks this document as never embeddable in a distributed artefact; must be true'),
    scope: z.string().optional().describe('which part of the organisation this document covers'),
    last_verified: z
      .string()
      .optional()
      .describe('when the identifiers were last checked against the live systems'),
    teams: z.array(definition).optional().describe('team ids and display names'),
    functions: z.array(definition).optional().describe('extensible function ids and display names'),
    memberships: z
      .array(membership)
      .optional()
      .describe('directory memberships and personal functions'),
    assignments: z.array(assignment).optional().describe('business collaboration assignments'),
    people: z.array(personSchema).describe('the people this document records'),
    areas: z
      .array(areaSchema)
      .optional()
      .describe('the ownership matrix: who is responsible for which part of the product'),
  })
  .describe('people, their identifiers across systems, and who owns what');
