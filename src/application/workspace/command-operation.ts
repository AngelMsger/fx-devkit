// Pin a selected registry identity before a command can refresh or mutate its local resources.

import { DevkitError } from '../../domain/errors.js';
import { samePath } from '../../domain/path.js';
import type { Lease, Lock } from '../../ports/lock.js';
import { resolveManifestDir } from '../manifest/locate.js';

import { assertNoWorkspaceOperation } from './health.js';
import { acquireWorkspaceOperation } from './operation.js';
import { resolveWorkspace, type Located, type ResolveInput } from './resolve.js';

export async function beginWorkspaceCommand(
  input: ResolveInput,
  lock: Lock,
  source: boolean,
): Promise<{ lease: Lease; located: Located } | null> {
  const selected = source ? await sourceIdentity(input) : await resolveWorkspace(input);
  if (!selected) return null;
  const before = (await input.config.read()).workspaces?.[selected.name];
  const lease = await acquireWorkspaceOperation(lock, selected.name);
  try {
    const after = (await input.config.read()).workspaces?.[selected.name];
    if (!after || JSON.stringify(before) !== JSON.stringify(after))
      throw new DevkitError(
        'conflict',
        'WORKSPACE_PLAN_CHANGED',
        'The workspace identity changed while waiting. Retry to use the new registration.',
        {
          nextSteps: [
            `fx workspace show ${selected.name}`,
            'Re-run the same command against the new registration.',
          ],
        },
      );
    await assertNoWorkspaceOperation(input, selected);
    return { lease, located: selected };
  } catch (error) {
    await lease.release();
    throw error;
  }
}

async function sourceIdentity(input: ResolveInput): Promise<Located | null> {
  const dir = await resolveManifestDir(input);
  const registry = (await input.config.read()).workspaces ?? {};
  for (const name of Object.keys(registry)) {
    if (samePath(await input.fs.realpath(dir), await input.fs.realpath(input.manifestDirFor(name))))
      return {
        name,
        root: await input.fs.realpath(registry[name]!.root),
        manifestDir: dir,
        selection: input.name ? 'explicit' : 'cwd',
      };
  }
  return null;
}
