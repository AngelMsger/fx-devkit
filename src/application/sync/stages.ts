// Resource-stage workflows for sync: execute application use cases and aggregate
// their outcomes. Composition supplies dependencies and host-specific callbacks;
// it does not decide stage policy or interpret execution results.

import { asDevkitError, withPartialResult } from '../../domain/errors.js';
import type { HarnessKind } from '../../domain/harness/ownership.js';
import { installsOnInit } from '../../domain/toolchain/resolve.js';
import { countBy } from '../../domain/values.js';
import type { ReplaceFiles } from '../../ports/replace-files.js';
import { DeriveDocs } from '../docs/derive.js';
import type { HarnessSession } from '../harness/session.js';
import { harnessStage } from '../harness/stages.js';
import type { HarnessStageDetails } from '../harness/types.js';
import { hookStage, type HookSession } from '../hook/session.js';
import type { HookStageDetails } from '../hook/types.js';
import type { LoginDeps } from '../login/deps.js';
import { prepareWorkspaceSetup } from '../login/stage.js';
import { findingCheck, type StageResult } from '../preparation.js';
import { prepareServices } from '../services/stage.js';
import { SkillStage } from '../skill/stage.js';
import type { SkillDeps } from '../skill/targets.js';
import { ToolCheck } from '../tool/check.js';
import type { ToolInstalled } from '../tool/installed.js';
import { workspaceToolScope } from '../tool/scope.js';
import { toolchainOf } from '../tool/toolchain.js';
import type { WorkspaceDeps } from '../workspace/deps.js';
import { syncGoWork } from '../workspace/go-work.js';
import type { ResolveInput } from '../workspace/resolve.js';

import { documentChecks, goWorkChecks, skillChecks, toolChecks } from './checks.js';
import type {
  DocsStageDetails,
  GoStageDetails,
  ResourceStage,
  ResourceStageDetails,
  SkillStageDetails,
  ToolStageDetails,
} from './types.js';

// What the resource stages need beyond the workspace bundle.
export interface SyncStageDeps {
  readonly inventory?: ToolInstalled;
  // The lifecycle sessions as ports: which resource each stage reconciles, in which
  // workspace, and that reconciling it is a sync, is this module's decision.
  readonly harness?: HarnessSession;
  readonly hooks?: HookSession;
  readonly replace?: ReplaceFiles;
  readonly login: LoginDeps;
  readonly skills: SkillDeps;
}

export interface SyncStageInput extends SyncStageDeps {
  readonly deps: WorkspaceDeps;
  readonly initialize?: boolean;
  readonly dryRun: boolean;
}

const STAGES: {
  readonly [Stage in ResourceStage]: (
    input: SyncStageInput,
  ) => Promise<StageResult<ResourceStageDetails[Stage]>>;
} = {
  services: (input) => prepareServices(input.deps, input.login, { dryRun: input.dryRun }),
  setup: (input) =>
    prepareWorkspaceSetup(input.deps, input.login, {
      initializing: input.initialize ?? false,
      dryRun: input.dryRun,
      posture: input.deps.trust.posture,
    }),
  docs: docsStage,
  go: goStage,
  skills: skillsStage,
  hooks: async (input) => (await hooksStage(input)) ?? { summary: { unsupported: 0 }, checks: [] },
  mcp: async (input) =>
    (await harnessResource(input, 'mcp')) ?? { summary: { unsupported: 0 }, checks: [] },
  tools: toolsStage,
};

// In the order a full sync runs them.
export function resourceStageIds(): string[] {
  return Object.keys(STAGES);
}

export function syncStageIds(): string[] {
  return ['repos', ...resourceStageIds()];
}

export function isResourceStage(stage: string): stage is ResourceStage {
  return Object.hasOwn(STAGES, stage);
}

export function runStage<Stage extends ResourceStage>(
  stage: Stage,
  input: SyncStageInput,
): Promise<StageResult<ResourceStageDetails[Stage]>> {
  return STAGES[stage](input);
}

// A session reconciles the workspace this sync holds, however the invocation named one.
function ofWorkspace<Session extends { readonly resolve: ResolveInput }>(
  session: Session,
  deps: WorkspaceDeps,
): Session {
  return { ...session, resolve: { ...session.resolve, name: deps.ctx.name } };
}

function harnessResource(
  input: SyncStageInput,
  only: HarnessKind,
): Promise<StageResult<HarnessStageDetails>> | undefined {
  if (input.harness === undefined) return undefined;
  const session = ofWorkspace(input.harness, input.deps);
  return harnessStage({ ...session, action: 'sync', only, dryRun: input.dryRun })();
}

function hooksStage(input: SyncStageInput): Promise<StageResult<HookStageDetails>> | undefined {
  return input.hooks === undefined
    ? undefined
    : hookStage({ ...ofWorkspace(input.hooks, input.deps), dryRun: input.dryRun })();
}

async function skillsStage(input: SyncStageInput): Promise<StageResult<SkillStageDetails>> {
  const { summary, ...details } = await new SkillStage(input.deps, input.skills).execute({
    ...(input.replace === undefined ? {} : { replace: input.replace }),
    toolchain: toolchainOf(input.deps.ctx).tools,
    dryRun: input.dryRun,
    posture: input.deps.trust.posture,
  });
  return {
    summary,
    details,
    checks: skillChecks({ summary, ...details }, workspaceToolScope(input.deps.ctx, {}).required),
  };
}

async function docsStage(input: SyncStageInput): Promise<StageResult<DocsStageDetails>> {
  const out = await new DeriveDocs(input.deps, input.login).execute({
    ...(input.replace === undefined ? {} : { replace: input.replace }),
    check: false,
    dryRun: input.dryRun,
    posture: input.deps.trust.posture,
  });
  const summary: Record<string, number> = {
    created: 0,
    updated: 0,
    unchanged: 0,
    foreign: 0,
    missing_regions: out.files.reduce((sum, file) => sum + file.missing.length, 0),
    ...countBy(out.files, (file) => file.action),
  };
  const rules = await harnessResource(input, 'rules')?.catch((error: unknown) => {
    throw withPartialResult(error, {
      files: out.files,
      rules: asDevkitError(error).partialResult ?? {},
    });
  });
  if (rules) {
    for (const [action, count] of Object.entries(rules.summary))
      if (typeof count === 'number') summary[`rules_${action}`] = count;
  }
  return {
    summary,
    checks: [...documentChecks(out.files), ...(rules?.checks ?? [])],
    details: {
      files: out.files,
      ...(rules?.details === undefined ? {} : { rules: rules.details }),
    },
  };
}

async function goStage(input: SyncStageInput): Promise<StageResult<GoStageDetails>> {
  const out = await syncGoWork(input.deps, {
    dryRun: input.dryRun,
    posture: input.deps.trust.posture,
  });
  return {
    summary: { modules: out.modules.length, go_work: out.file?.action ?? 'none' },
    checks: goWorkChecks(out),
    details: { ...out },
  };
}

async function toolsStage(input: SyncStageInput): Promise<StageResult<ToolStageDetails>> {
  const scope = workspaceToolScope(input.deps.ctx, {}, input.deps.commandShell);
  const tools = scope.covered;
  const problems = scope.problems;
  const requiresPreparation = (name: string): boolean =>
    scope.required.has(name) || tools.some((tool) => tool.name === name && installsOnInit(tool));
  const rows = (
    await new ToolCheck(input.deps.process).execute({
      continueOnError: true,
      tools: tools.map((tool) => ({ ...tool, required: scope.required.has(tool.name) })),
      trust: { ...input.deps.trust, dryRun: input.dryRun },
    })
  ).map((row) => ({ ...row, preparation_required: requiresPreparation(row.name) }));
  const summary = Object.fromEntries(
    ['ok', 'missing', 'outdated', 'disabled', 'unknown'].map((state) => [
      state,
      rows.filter(
        (r) =>
          r.state === state && (r.preparation_required || state === 'ok' || state === 'disabled'),
      ).length,
    ]),
  );
  const installations = (await input.inventory?.execute()) ?? [];
  const unused = installations.filter((item) => item.state === 'unused');
  for (const item of unused)
    input.deps.reporter.notice({
      code: 'TOOL_UNUSED',
      message: `${item.name}: ${item.uninstall_hint}`,
      nextSteps: ['fx tool inventory', 'fx tool history'],
      data: { installation: item },
    });
  return {
    checks: [
      ...toolChecks(rows, input.deps),
      ...problems.map((problem) => findingCheck(problem, true)),
    ],
    summary: {
      ...summary,
      unused: unused.length,
      problems: problems.length,
      blocked: rows.filter((row) => row.preparation_required && row.state === 'disabled').length,
    },
    details: {
      items: rows,
      problems,
      installations: installations.map((row) => ({
        ...row,
        preparation_required: requiresPreparation(row.name),
      })),
    },
  };
}
