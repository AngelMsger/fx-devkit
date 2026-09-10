// Resource-stage workflows for sync: execute application use cases and aggregate
// their outcomes. Composition supplies dependencies and host-specific callbacks;
// it does not decide stage policy or interpret execution results.

import type { Process } from '../../ports/process.js';
import type { ReplaceFiles } from '../../ports/replace-files.js';
import { DeriveDocs } from '../docs/derive.js';
import type { LoginDeps } from '../login/deps.js';
import type { WritePosture } from '../safety/posture.js';
import type { TrustContext } from '../safety/trust.js';
import { SkillStage } from '../skill/stage.js';
import type { SkillDeps } from '../skill/targets.js';
import type { StageResult, SyncStages } from '../sync.js';
import { ToolCheck } from '../tool/check.js';
import { toolchainOf } from '../tool/toolchain.js';
import type { WorkspaceDeps } from '../workspace/deps.js';

export interface SyncStageInput {
  readonly mcp?: () => Promise<StageResult>;
  readonly rules?: () => Promise<StageResult>;
  readonly hooks?: () => Promise<StageResult>;
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
  docs: docsStage,
  skills: skillsStage,
  hooks: async (input) => (await input.hooks?.()) ?? { summary: { unsupported: 0 } },
  mcp: async (input) => (await input.mcp?.()) ?? { summary: { unsupported: 0 } },
  tools: toolsStage,
};

export function syncStageIds(): string[] {
  return ['repos', ...Object.keys(STAGES)];
}

export function syncStages(input: SyncStageInput): SyncStages {
  return Object.fromEntries(Object.entries(STAGES).map(([id, run]) => [id, () => run(input)]));
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
  const rules = await input.rules?.();
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
  const rows = await new ToolCheck(input.process).execute({
    tools: toolchainOf(input.deps.ctx).tools,
    trust: { ...input.trust, dryRun: input.dryRun },
  });
  const summary = Object.fromEntries(
    ['ok', 'missing', 'outdated', 'disabled', 'unknown'].map((state) => [
      state,
      rows.filter((r) => r.state === state).length,
    ]),
  );
  return { summary, details: { items: rows } };
}
