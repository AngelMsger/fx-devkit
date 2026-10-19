// Refresh eligible Git manifest sources and explain any local work retained.

import { busyError } from '../../domain/errors.js';
import { workspaceLeaseKey } from '../../domain/lease.js';
import type { Lock } from '../../ports/lock.js';
import type { ManifestSource, RefreshOutcome } from '../../ports/manifest-source.js';
import type { Reporter } from '../../ports/reporter.js';
import { assertWritable, type WritePosture } from '../safety/posture.js';
import { resolveWorkspace, type ResolveInput } from '../workspace/resolve.js';

export interface RefreshManifestInput {
  readonly manifestDir: string;
  readonly source: ManifestSource | undefined;
  readonly dryRun: boolean;
  readonly posture: WritePosture;
  // Told after every successful fetch: the remote-tracking ref is current
  // even when the checkout itself was left alone.
  readonly settle?: () => Promise<void>;
}

export interface RefreshManifestOutput {
  readonly result: RefreshOutcome['result'] | 'unavailable' | 'static' | 'planned';
  readonly reason?: string;
  readonly source: string | null;
}

export class RefreshManifest {
  constructor(private readonly reporter: Reporter) {}

  async execute(input: RefreshManifestInput): Promise<RefreshManifestOutput> {
    const { source } = input;
    if (source === undefined) {
      this.reporter.notice({
        code: 'MANIFEST_REFRESH_UNAVAILABLE',
        message: 'this workspace has no recorded manifest source',
        nextSteps: ['fx config get default_workspace', 'fx init <root> --from <source>'],
      });
      return { result: 'unavailable', source: null };
    }
    if (source.refresh === undefined) return { result: 'static', source: source.description };
    if (input.dryRun) {
      this.reporter.notice({
        code: 'MANIFEST_REFRESH_PLANNED',
        message: `would pull the manifest repository from ${source.description}`,
      });
      return { result: 'planned', source: source.description };
    }
    assertWritable(input.posture, 'refresh manifest');
    const outcome = await source.refresh(input.manifestDir);
    await input.settle?.();
    if (outcome.result === 'updated') {
      this.reporter.notice({
        code: 'MANIFEST_REFRESHED',
        message: `manifest refreshed from ${source.description}`,
      });
    }
    if (outcome.result === 'kept') {
      this.reporter.notice({
        code: 'MANIFEST_REFRESH_KEPT',
        message: `the manifest checkout at ${input.manifestDir} was left as it is (${outcome.reason}); sync used the manifest as checked out there`,
        nextSteps: [
          `git -C ${input.manifestDir} status`,
          'return to the default branch, or open the pull request, when the work is done',
        ],
      });
    }
    return { ...outcome, source: source.description };
  }
}

// Refresh the registered source before loading its manifest, under the same
// workspace lease used by resource synchronization. Broken manifests remain repairable.

interface RefreshWorkspaceDeps {
  readonly lock: Lock;
  readonly sourceFor: (spec: string) => Promise<ManifestSource>;
  readonly settle: (name: string, manifestDir: string) => Promise<void>;
}

export async function refreshWorkspaceManifest(
  deps: RefreshWorkspaceDeps,
  resolve: ResolveInput,
  run: { readonly dryRun: boolean; readonly posture: WritePosture },
): Promise<void> {
  const located = await resolveWorkspace(resolve);
  const entry = (await resolve.config.read()).workspaces?.[located.name];
  const source = entry?.source === undefined ? undefined : await deps.sourceFor(entry.source);
  const lease =
    run.dryRun || run.posture.readOnly
      ? undefined
      : await deps.lock.acquire({ key: workspaceLeaseKey(located.name), waitMs: 2000 });
  if (lease === null)
    throw busyError('LOCK_BUSY', 'The workspace', { nextSteps: ['Retry fx sync shortly.'] });
  try {
    await new RefreshManifest(resolve.reporter).execute({
      manifestDir: located.manifestDir,
      source,
      ...run,
      settle: () => deps.settle(located.name, located.manifestDir),
    });
  } finally {
    await lease?.release();
  }
}
