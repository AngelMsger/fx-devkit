import { discoverWorkspaces } from '../../../application/workspace/discover.js';
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
      cliVersion: this.config.version,
    });
    this.renderer.list(items, {
      columns: [
        'name',
        'root',
        'source',
        'default',
        'cwd_match',
        'selected',
        'selection',
        'status',
      ],
      trailer,
    });
  }
}
