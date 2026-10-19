// Plan content-dependent local preparation after source validation, before
// installers or repository synchronization can execute. No preview grants trust.
import type { LoginDeps } from '../login/deps.js';
import { prepareServices } from '../services/stage.js';
import type { SkillStage } from '../skill/stage.js';
import type { SkillStageOutput } from '../skill/types.js';
import type { ServiceStageDetails, StageResult } from '../sync/types.js';
import type { ToolInstall, ToolInstallOutput } from '../tool/install.js';
import { toolchainOf } from '../tool/toolchain.js';
import type { WorkspaceDeps } from '../workspace/deps.js';

export interface InitializationPreview {
  readonly root: string;
  readonly source: string;
  readonly tool_install: readonly ToolInstallOutput[];
  readonly skills: SkillStageOutput;
  readonly note: string;
  readonly services: StageResult<ServiceStageDetails>;
}

export class PreviewInitialization {
  constructor(
    private readonly deps: WorkspaceDeps,
    private readonly login: LoginDeps,
    private readonly install: ToolInstall,
    private readonly skills: SkillStage,
  ) {}

  async execute(): Promise<InitializationPreview> {
    const { ctx } = this.deps;
    const trust = { ...this.deps.trust, dryRun: true };
    const tools = toolchainOf(ctx).tools;
    const installs = await this.install.execute({
      tools: tools.filter((tool) => tool.enabled && tool.installOnInit),
      all: true,
      update: false,
      dryRun: true,
      posture: trust.posture,
      trust,
    });
    const skills = await this.skills.execute({
      dryRun: true,
      posture: trust.posture,
      toolchain: tools,
    });
    return {
      root: ctx.root,
      source: ctx.manifestDir,
      tool_install: installs,
      skills,
      note: 'Missing tools may reveal additional Skill vectors after installation; those require their own exact trust check. Foreign paths still require replacement approval and backup.',
      services: await prepareServices(this.deps, this.login, { dryRun: true }),
    };
  }
}
