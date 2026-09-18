import { discoverWorkspaces, WORKSPACE_COLUMNS } from '../../../application/workspace/discover.js';
import { FxCommand } from '../../base.js';

export default class WorkspaceList extends FxCommand {
  static override description =
    'List registered workspaces from any directory, including unavailable roots and manifests';
  static override flags = {};
  async run(): Promise<void> {
    await this.parse(WorkspaceList);
    const {
      items,
      has_more: _hasMore,
      ...trailer
    } = await discoverWorkspaces({
      ...this.resolveInput(),
      bundledTools: this.container.bundledTools,
      providers: this.container.providers,
      cliVersion: this.config.version,
    });
    this.renderer.list(items, {
      columns: WORKSPACE_COLUMNS,
      trailer,
    });
  }
}
