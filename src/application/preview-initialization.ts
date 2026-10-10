// Plan content-dependent local preparation after source validation, before
// installers or repository synchronization can execute. No preview grants trust.
import type { LoginDeps } from './login/deps.js';
import type { TrustContext } from './safety/trust.js';
import { prepareServices } from './services/stage.js';
import type { SkillStage } from './skill/stage.js';
import type { ToolInstall } from './tool/install.js';
import { toolchainOf } from './tool/toolchain.js';
import type { WorkspaceDeps } from './workspace/deps.js';

export class PreviewInitialization {
  constructor(
    private readonly deps: WorkspaceDeps,
    private readonly login: LoginDeps,
    private readonly install: ToolInstall,
    private readonly skills: SkillStage,
  ) {}

  async execute(trust: TrustContext): Promise<object> {
    const { ctx } = this.deps;
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
      trust,
    });
    return {
      root: ctx.root,
      source: ctx.manifestDir,
      tool_install: installs,
      skills,
      note: 'Missing tools may reveal additional Skill vectors after installation; those require their own exact trust check. Foreign paths still require replacement approval and backup.',
      services: await prepareServices(this.deps, this.login, true),
    };
  }
}
