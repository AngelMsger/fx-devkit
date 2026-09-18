// Resource-stage workflows for sync: execute application use cases and aggregate
// their outcomes. Composition supplies dependencies and host-specific callbacks;
// it does not decide stage policy or interpret execution results.

import type { Process } from '../../ports/process.js';
import type { ReplaceFiles } from '../../ports/replace-files.js';
import { DeriveDocs } from '../docs/derive.js';
import type { HarnessSession } from '../harness/session.js';
import { harnessStage } from '../harness/stages.js';
import { hookStage, type HookSession } from '../hook/session.js';
import type { LoginDeps } from '../login/deps.js';
import type { WritePosture } from '../safety/posture.js';
import type { TrustContext } from '../safety/trust.js';
import { prepareServices } from '../services/stage.js';
import { SkillStage } from '../skill/stage.js';
import type { SkillDeps } from '../skill/targets.js';
import type { StageResult, SyncStages } from '../sync.js';
import { ToolCheck } from '../tool/check.js';
import type { ToolInstalled } from '../tool/installed.js';
import { workspaceToolScope } from '../tool/scope.js';
import { toolchainOf } from '../tool/toolchain.js';
import type { WorkspaceDeps } from '../workspace/deps.js';

export interface SyncStageInput {
  readonly inventory?: ToolInstalled;
  // The lifecycle sessions as ports: which resource each stage reconciles, and that
  // reconciling it is a sync, is this module's decision.
  readonly harness?: HarnessSession;
  readonly hooks?: HookSession;
  readonly replace?: ReplaceFiles;
  readonly deps: WorkspaceDeps;
  readonly login: LoginDeps;
  readonly skills: SkillDeps;
  readonly process: Process;
  readonly trust: TrustContext;
  readonly dryRun: boolean;
  readonly posture: WritePosture;
}

const STAGES: Readonly<Record<string, (input: SyncStageInput) => Promise<StageResult>>> = {
  services: (input) => prepareServices(input.deps, input.login, input.dryRun),
  docs: docsStage,
  skills: skillsStage,
  hooks: async (input) => (await hooksStage(input)) ?? { summary: { unsupported: 0 } },
  mcp: async (input) => (await harnessResource(input, 'mcp')) ?? { summary: { unsupported: 0 } },
  tools: toolsStage,
};

export function syncStageIds(): string[] {
  return ['repos', ...Object.keys(STAGES)];
}

export function syncStages(input: SyncStageInput): SyncStages {
  return Object.fromEntries(Object.entries(STAGES).map(([id, run]) => [id, () => run(input)]));
}

function harnessResource(
  input: SyncStageInput,
  only: 'mcp' | 'rules',
): Promise<StageResult> | undefined {
  if (input.harness === undefined) return undefined;
  return harnessStage({ ...input.harness, action: 'sync', only, dryRun: input.dryRun })();
}

function hooksStage(input: SyncStageInput): Promise<StageResult> | undefined {
  return input.hooks === undefined
    ? undefined
    : hookStage({ ...input.hooks, dryRun: input.dryRun })();
}

async function skillsStage(input: SyncStageInput): Promise<StageResult> {
  const { summary, ...details } = await new SkillStage(input.deps, input.skills).execute({
    ...(input.replace === undefined ? {} : { replace: input.replace }),
    toolchain: toolchainOf(input.deps.ctx).tools,
    trust: input.trust,
    dryRun: input.dryRun,
    posture: input.posture,
  });
  return { summary, details };
}

async function docsStage(input: SyncStageInput): Promise<StageResult> {
  const out = await new DeriveDocs(input.deps, input.login).execute({
    ...(input.replace === undefined ? {} : { replace: input.replace }),
    check: false,
    dryRun: input.dryRun,
    posture: input.posture,
  });
  const summary: Record<string, number> = {
    created: 0,
    updated: 0,
    unchanged: 0,
    foreign: 0,
    missing_regions: 0,
  };
  for (const file of out.files) {
    summary[file.action] = (summary[file.action] ?? 0) + 1;
    summary['missing_regions'] = (summary['missing_regions'] ?? 0) + file.missing.length;
  }
  const rules = await harnessResource(input, 'rules');
  if (rules) {
    for (const [action, count] of Object.entries(rules.summary))
      if (typeof count === 'number') summary[`rules_${action}`] = count;
  }
  return {
    summary,
    details: {
      files: out.files,
      ...(rules?.details === undefined ? {} : { rules: rules.details }),
    },
  };
}

async function toolsStage(input: SyncStageInput): Promise<StageResult> {
  const scope = workspaceToolScope(
    input.deps.ctx,
    input.login.describeProvider,
    {},
    input.deps.commandShell,
  );
  const tools = toolchainOf(input.deps.ctx).tools.filter((tool) => scope.names.includes(tool.name));
  const problems = scope.problems;
  const requiresPreparation = (name: string): boolean =>
    scope.required.has(name) ||
    tools.some((tool) => tool.name === name && tool.enabled && tool.installOnInit);
  const rows = (
    await new ToolCheck(input.process).execute({
      tools: tools.map((tool) => ({ ...tool, required: scope.required.has(tool.name) })),
      trust: {
        ...input.trust,
        dryRun: input.dryRun,
        workspace: input.deps.ctx.name,
        commandShell: input.deps.commandShell,
      },
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
