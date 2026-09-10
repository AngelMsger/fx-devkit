import { selfInfo, type WorkspaceInfo } from '../../../application/self/info.js';
import { bundledSkillDir } from '../../../composition/bundled.js';
import { DevkitError } from '../../../domain/errors.js';
import { FxCommand } from '../../base.js';

export default class SelfInfoCommand extends FxCommand {
  static override description =
    'Where this fx is: version, runtime, personal directory, bundled assets, registry, workspace';
  static override examples = ['<%= config.bin %> self info --format json'];
  static override flags = {};

  async run(): Promise<void> {
    await this.parse(SelfInfoCommand);
    const pjson = this.config.pjson as { name: string };
    this.renderer.record(
      selfInfo({
        name: pjson.name,
        version: this.config.version,
        runtime: runtimeLabel(),
        fxHome: this.container.fxHome,
        configPath: this.container.config.path(),
        trustPath: this.container.trust.path(),
        bundledTools: new URL('../../../../defaults/tools.yaml', import.meta.url).pathname,
        bundledSkill: bundledSkillDir(),
        registry: this.fxUpdateInput().registry,
        workspace: await this.currentWorkspace(),
      }),
    );
  }

  private async currentWorkspace(): Promise<WorkspaceInfo | null> {
    try {
      const ctx = await this.workspace();
      return { name: ctx.name, root: ctx.root, manifest: ctx.manifestDir };
    } catch (err) {
      if (err instanceof DevkitError && err.code === 'WORKSPACE_NOT_FOUND') return null;
      throw err;
    }
  }
}

function runtimeLabel(): string {
  const bun = (process.versions as Record<string, string | undefined>)['bun'];
  return bun === undefined ? `node ${process.versions.node}` : `bun ${bun}`;
}
