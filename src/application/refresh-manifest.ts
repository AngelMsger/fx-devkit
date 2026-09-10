// Pulls the manifest source before a sync, and says what happened to the
// checkout. A registration without a source is worth a word; a directory
// source is not.

import type { ManifestSource, RefreshOutcome } from '../ports/manifest-source.js';
import type { Reporter } from '../ports/reporter.js';

import { assertWritable, type WritePosture } from './safety/posture.js';

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
