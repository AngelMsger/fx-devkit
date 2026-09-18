import { showWorkspace } from '../../../application/workspace/discover.js';
import { FxCommand } from '../../base.js';
import { argument } from '../../flags.js';

export default class WorkspaceShow extends FxCommand {
  static override description =
    'Show registered identity, selection provenance, source and readiness without requiring a healthy manifest';
  static override args = {
    name: argument('registered name; defaults to current workspace resolution'),
  };
  static override flags = {};
  async run(): Promise<void> {
    const { args } = await this.parse(WorkspaceShow);
    const resolve = this.resolveInput();
    this.renderer.record(
      await showWorkspace({
        ...resolve,
        name: args.name ?? resolve.name,
        bundledTools: this.container.bundledTools,
        providers: this.container.providers,
        cliVersion: this.config.version,
      }),
    );
  }
}
