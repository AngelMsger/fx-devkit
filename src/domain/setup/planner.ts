// From recipes, the team's own steps and the environments to a concrete plan. Expansion
// is literal about absence: an undeclared platform gets no step, and a recipe whose
// variables the manifest cannot supply is a problem rather than a half-filled step. Order
// is stable: required tools, the toolchain's order, the environments' order, prerequisites
// first.

import type { Environments } from '../manifest/types.js';
import { substitute, substituteAll, type Vars } from '../template.js';
import { commandOrigin, type ResolvedTool } from '../toolchain/resolve.js';

import type {
  FailureCase,
  PlanProblem,
  ServicePreparation,
  SetupCheck,
  SetupPlan,
  SetupRecipe,
  SetupStep,
} from './types.js';

export interface RecipeSource {
  readonly recipe: SetupRecipe;
  readonly vars: Vars;
  // The platform instance this recipe was collected for; per-environment
  // recipes expand over the environments that declare it.
  readonly platform?: string | undefined;
  readonly env?: string;
  readonly preparation?: ServicePreparation;
  readonly executionEnv?: Readonly<Record<string, string>>;
}

export interface PlanInput {
  readonly tools: readonly ResolvedTool[];
  readonly recipes: readonly RecipeSource[];
  readonly providerTools: readonly string[];
  readonly environments: Environments | undefined;
  readonly scopeEnvs: readonly string[] | undefined;
  readonly filter?: {
    readonly tools?: readonly string[] | undefined;
    readonly envs?: readonly string[] | undefined;
  };
}

export function planSetup(input: PlanInput): SetupPlan {
  const problems: PlanProblem[] = [];
  const tools = new Map(input.tools.filter((t) => t.enabled).map((t) => [t.name, t]));
  const envs = Object.entries(input.environments?.envs ?? {}).filter(
    ([name]) => within(name, input.scopeEnvs) && within(name, input.filter?.envs),
  );

  const drafts: SetupStep[] = [];
  for (const source of input.recipes) {
    const tool = tools.get(source.recipe.tool);
    if (tool === undefined) {
      if (input.tools.some((t) => t.name === source.recipe.tool)) continue;
      problems.push({
        step: stepId(source.recipe.tool, source.recipe.id),
        reason: 'tool_unknown',
        detail: `${source.recipe.tool} is not in the toolchain`,
      });
      continue;
    }
    if (!source.recipe.perEnv) {
      draft(fromSource(tool, source));
      continue;
    }
    for (const [env, spec] of envs) {
      const onPlatform =
        source.platform === undefined ? undefined : spec.platforms?.[source.platform];
      if (onPlatform === undefined) continue;
      const vars: Vars = {
        ...source.recipe.defaults,
        ...source.vars,
        ...onPlatform.vars,
        ...prefixed('setup', onPlatform.setup),
        env,
      };
      draft(fromRecipe(tool, source.recipe, vars, env));
    }
  }
  for (const tool of tools.values())
    for (const step of tool.setup) drafts.push(fromTeam(tool, step));
  const providerTools = new Set(input.providerTools);
  // A provider owns its readiness recipe; bundled defaults alone do not enroll an unused tool.
  for (const tool of tools.values()) {
    const authConfig = tool.auth;
    const teamOwnsAuth = tool.origins.auth === 'patch';
    if (authConfig === undefined || !teamOwnsAuth || providerTools.has(tool.name)) continue;
    const auth = fromAuth(tool, authConfig);
    const alreadyCovered = drafts.some(
      (step) =>
        step.tool === tool.name && (step.id === auth.id || sameCommand(step.verify, auth.verify)),
    );
    if (!alreadyCovered) drafts.push(auth);
  }

  const selected = drafts.filter((s) => within(s.tool, input.filter?.tools));
  return { steps: order(uniqueSteps(selected, problems), input, problems), problems };

  function draft(result: SetupStep | PlanProblem): void {
    if ('reason' in result) problems.push(result);
    else drafts.push(result);
  }
}

function fromSource(tool: ResolvedTool, source: RecipeSource): SetupStep | PlanProblem {
  const step = fromRecipe(
    tool,
    source.recipe,
    { ...source.recipe.defaults, ...source.vars },
    source.env,
  );
  if ('reason' in step) return step;
  return {
    ...step,
    ...(source.preparation ? { preparation: source.preparation } : {}),
    ...(source.executionEnv ? { executionEnv: source.executionEnv } : {}),
  };
}

function fromRecipe(
  tool: ResolvedTool,
  recipe: SetupRecipe,
  vars: Vars,
  env?: string,
): SetupStep | PlanProblem {
  const missing = new Set<string>();
  const vector = (parts: readonly string[] | undefined): readonly string[] | undefined => {
    if (parts === undefined) return undefined;
    const done = substituteAll(parts, vars);
    done.missing.forEach((m) => missing.add(m));
    return [tool.binary, ...done.vector];
  };
  const filled = (template: string): string => {
    const done = substitute(template, vars);
    done.missing.forEach((m) => missing.add(m));
    return done.text;
  };
  const text = (template: string | undefined): string | undefined =>
    template === undefined ? undefined : filled(template);
  // An id may name what the step is scoped to, such as a host: steps for two hosts
  // stay two, and the same host from two bindings is still one step.
  const id = stepId(tool.name, filled(recipe.id), env);
  const run = vector(recipe.run);
  const expects = text(recipe.expects?.path);
  const verify = check(recipe.verify, vector, text, (failure) => advised(failure, vars));
  const requires = (recipe.requires ?? []).map((dep) => stepId(tool.name, filled(dep), env));
  if (missing.size > 0) {
    return {
      step: id,
      reason: 'missing_vars',
      detail: `${[...missing].map((m) => `{${m}}`).join(', ')} not supplied by the manifest`,
    };
  }
  // Advisory text degrades: a page whose address is unknown is left out,
  // a title keeps its placeholder; only executable fields are strict.
  const open = substitute(recipe.open ?? '', vars);
  return {
    id,
    tool: tool.name,
    ...(env === undefined ? {} : { env }),
    kind: recipe.kind,
    ...(recipe.phase ? { phase: recipe.phase } : {}),
    title: substitute(recipe.title, vars).text,
    ...(run === undefined ? {} : { run }),
    ...(recipe.instructions === undefined
      ? {}
      : { instructions: substitute(recipe.instructions, vars).text }),
    ...(recipe.open === undefined || open.missing.length > 0 ? {} : { open: open.text }),
    ...(expects === undefined ? {} : { expects: { path: expects } }),
    verify,
    requires,
    origin: commandOrigin(tool),
    required: tool.required,
  };
}

function fromTeam(tool: ResolvedTool, step: ResolvedTool['setup'][number]): SetupStep {
  const withBinary = (parts: readonly string[]): readonly string[] => [tool.binary, ...parts];
  return {
    id: stepId(tool.name, step.id),
    tool: tool.name,
    kind: step.kind,
    ...(step.phase ? { phase: step.phase } : {}),
    title: step.title,
    ...(step.run === undefined ? {} : { run: withBinary(step.run) }),
    ...(step.instructions === undefined ? {} : { instructions: step.instructions }),
    ...(step.open === undefined ? {} : { open: step.open }),
    ...(step.expects === undefined ? {} : { expects: { path: step.expects.path } }),
    verify: check(step.verify, withBinary, (t) => t),
    requires: (step.requires ?? []).map((dep) => stepId(tool.name, dep)),
    origin: commandOrigin(tool, 'setup'),
    required: tool.required,
  };
}

function fromAuth(tool: ResolvedTool, auth: NonNullable<ResolvedTool['auth']>): SetupStep {
  return {
    id: stepId(tool.name, 'auth'),
    tool: tool.name,
    kind: 'manual',
    title: `Authenticate ${tool.name}`,
    ...(auth.docs === undefined ? {} : { open: auth.docs }),
    verify: { command: [tool.binary, ...auth.command] },
    requires: [],
    origin: commandOrigin(tool, 'auth'),
    required: tool.required,
  };
}

function sameCommand(left: SetupCheck, right: SetupCheck): boolean {
  if (!('command' in left) || !('command' in right)) return false;
  return (
    left.command.length === right.command.length &&
    left.command.every((part, index) => part === right.command[index])
  );
}

function check(
  source: SetupCheck,
  vector: (parts: readonly string[]) => readonly string[] | undefined,
  text: (template: string) => string | undefined,
  failure: (source: FailureCase) => FailureCase = (source) => source,
): SetupCheck {
  if ('command' in source)
    return {
      command: vector(source.command) ?? [],
      ...(source.json === undefined ? {} : { json: source.json }),
      ...(source.failures === undefined ? {} : { failures: source.failures.map(failure) }),
    };
  if ('file' in source) return { file: text(source.file) ?? '' };
  return source;
}

// A failure case's guidance is advisory text like a step's own and degrades the same
// way; its patterns are not templates and stay as written.
function advised(source: FailureCase, vars: Vars): FailureCase {
  const { open: page, ...rest } = source;
  const open = substitute(page ?? '', vars);
  return {
    ...rest,
    instructions: substitute(source.instructions, vars).text,
    ...(page === undefined || open.missing.length > 0 ? {} : { open: open.text }),
  };
}

// A stable step ID may be shared only by identical expanded definitions. Conflicts
// and their dependants are withheld so no platform inherits another one's check.
function uniqueSteps(steps: readonly SetupStep[], problems: PlanProblem[]): SetupStep[] {
  const byId = new Map<string, SetupStep>();
  const blocked = conflictingServices(steps, problems);
  for (const step of steps) {
    const existing = byId.get(step.id);
    if (existing === undefined) byId.set(step.id, step);
    else if (JSON.stringify(existing) !== JSON.stringify(step) && !blocked.has(step.id)) {
      blocked.add(step.id);
      problems.push({
        step: step.id,
        reason: 'step_conflict',
        detail: `Conflicting definitions for ${step.id}; use one setup definition per tool, step and environment.`,
      });
    }
  }
  let changed = true;
  while (changed) {
    changed = false;
    for (const step of byId.values()) {
      const conflict = step.requires.find((id) => blocked.has(id));
      if (conflict === undefined || blocked.has(step.id)) continue;
      blocked.add(step.id);
      problems.push({
        step: step.id,
        reason: 'requires_unknown',
        detail: `${conflict} is unavailable because its setup definition conflicts`,
      });
      changed = true;
    }
  }
  return [...byId.values()].filter((step) => !blocked.has(step.id));
}

function order(
  steps: readonly SetupStep[],
  input: PlanInput,
  problems: PlanProblem[],
): SetupStep[] {
  const toolRank = new Map(input.tools.map((t, i) => [t.name, (t.required ? 0 : 1) * 1000 + i]));
  const envRank = new Map(Object.keys(input.environments?.envs ?? {}).map((e, i) => [e, i + 1]));
  const byId = new Map(steps.map((s) => [s.id, s]));
  const grouped = [...steps].sort(
    (a, b) =>
      (toolRank.get(a.tool) ?? 0) - (toolRank.get(b.tool) ?? 0) ||
      (envRank.get(a.env ?? '') ?? 0) - (envRank.get(b.env ?? '') ?? 0),
  );
  const resolved: SetupStep[] = [];
  const placed = new Set<string>();
  const visiting = new Set<string>();
  // A step follows its prerequisites and otherwise keeps its group order.
  const place = (step: SetupStep): void => {
    if (placed.has(step.id)) return;
    if (visiting.has(step.id)) {
      problems.push({
        step: step.id,
        reason: 'requires_cycle',
        detail: `depends on ${step.requires.join(', ')}`,
      });
      return;
    }
    visiting.add(step.id);
    const requires = step.requires.filter((dep) => {
      const target = byId.get(dep);
      if (target !== undefined) {
        place(target);
        return true;
      }
      problems.push({
        step: step.id,
        reason: 'requires_unknown',
        detail: `${dep} is not in the plan`,
      });
      return false;
    });
    visiting.delete(step.id);
    placed.add(step.id);
    resolved.push({ ...step, requires });
  };
  grouped.forEach(place);
  return resolved;
}

function stepId(tool: string, id: string, env?: string): string {
  return `${tool}.${id}${env === undefined ? '' : `@${env}`}`;
}

function within(name: string, list: readonly string[] | undefined): boolean {
  return list === undefined || list.includes(name);
}

function prefixed(prefix: string, record: Readonly<Record<string, string>> | undefined): Vars {
  return Object.fromEntries(Object.entries(record ?? {}).map(([k, v]) => [`${prefix}.${k}`, v]));
}

// One native destination cannot receive incompatible declarations in one plan.
function conflictingServices(steps: readonly SetupStep[], problems: PlanProblem[]): Set<string> {
  const targets = new Map<string, SetupStep[]>();
  const blocked = new Set<string>();
  for (const step of steps) {
    const prep = step.preparation;
    if (!prep) continue;
    const key = prep.kind === 'file' ? prep.relative : `${step.tool}:${prep.resource}`;
    const previous = targets.get(key) ?? [];
    previous.push(step);
    targets.set(key, previous);
  }
  for (const group of targets.values()) {
    if (new Set(group.map((step) => JSON.stringify(step.preparation))).size < 2) continue;
    for (const step of group) {
      blocked.add(step.id);
      problems.push({
        step: step.id,
        reason: 'step_conflict',
        detail:
          'Multiple service declarations disagree about the same local destination; use distinct contexts.',
      });
    }
  }
  return blocked;
}
