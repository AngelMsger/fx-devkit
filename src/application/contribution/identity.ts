// Recheck the captured registration under the operation lease before writing source state.

import { DevkitError } from '../../domain/errors.js';
import { samePath } from '../../domain/path.js';
import { shellLine } from '../../domain/shell.js';
import { assertNoWorkspaceOperation } from '../workspace/health.js';

import type { PushSourceDeps } from './push-types.js';

export async function assertContributionIdentity(deps: PushSourceDeps): Promise<void> {
  const { config, fs, expected } = deps.registration;
  const current = (await config.read()).workspaces?.[deps.source.workspace];
  if (
    !current ||
    current.root !== expected.root ||
    current.source !== expected.source ||
    (await fs.readLink(deps.source.dir)) !== undefined ||
    !samePath(await fs.realpath(deps.source.dir), deps.source.dir)
  )
    throw new DevkitError(
      'conflict',
      'WORKSPACE_PLAN_CHANGED',
      'The registered source identity changed after contribution planning.',
      {
        hint: 'Inspect the current workspace and preview the contribution again before retrying.',
        nextSteps: [shellLine(['fx', 'workspace', 'show', deps.source.workspace])],
      },
    );
  await assertNoWorkspaceOperation(
    { fs },
    { name: deps.source.workspace, manifestDir: deps.source.dir },
  );
}
