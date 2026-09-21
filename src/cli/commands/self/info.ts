import { selfInfo, type WorkspaceInfo } from '../../../application/self/info.js';
import { showWorkspace } from '../../../application/workspace/discover.js';
import { bundledSkillDir } from '../../../composition/bundled.js';
import { asDevkitError, toEnvelope } from '../../../domain/errors.js';
import { FxCommand } from '../../base.js';

export default class SelfInfoCommand extends FxCommand {
  static override description =
    'Where this fx is: version, runtime, personal directory, bundled assets, effective registry and its source, workspace';
  static override examples = ['<%= config.bin %> self info --format json'];
  static override flags = {};

  async run(): Promise<void> {
    await this.parse(SelfInfoCommand);
    const current = await this.currentWorkspace();
    const location = await this.fxUpdateInput();
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
        registry: location.registry,
        registrySource: location.registrySource,
        workspace: current.workspace,
        workspaceError: current.error,
      }),
    );
  }

  private async currentWorkspace() {
    try {
      const workspace: WorkspaceInfo = await showWorkspace({
        ...this.resolveInput(),
        bundledTools: this.container.bundledTools,
        providers: this.container.providers,
        cliVersion: this.config.version,
      });
      return { workspace, error: null };
    } catch (err) {
      return { workspace: null, error: toEnvelope(asDevkitError(err)).error };
    }
  }
}

function runtimeLabel(): string {
  const bun = (process.versions as Record<string, string | undefined>)['bun'];
  return bun === undefined ? `node ${process.versions.node}` : `bun ${bun}`;
}
