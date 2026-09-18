// Has the manifest repository moved upstream since the last sync? Asked of
// the remote directly, without fetching or touching the checkout; the
// remote's HEAD is compared with what sync last fetched of the default
// branch, so a checkout parked on a branch still hears about it. The branch
// is the remote's word, else the clone's record of it; never a guess.

import { DevkitError } from '../../domain/errors.js';
import type { Git } from '../../ports/git.js';

import type { CachedProbe } from './check.js';
import { MANIFEST_UPDATE_TTL_MS, PROBE_TIMEOUT_MS } from './policy.js';

export const manifestUpdateKey = (workspace: string): string => `update/manifest/${workspace}`;

export interface ManifestUpdateInput {
  readonly workspace: string;
  readonly sourceDir: string;
  readonly force?: boolean;
}

interface Heads {
  readonly upstream: string;
  readonly fetched: string;
}

export interface ManifestVerdict {
  readonly workspace: string;
  readonly upstream: string | null;
  readonly fetched: string | null;
  readonly behind: boolean;
  readonly source: 'cache' | 'live' | 'skipped';
  readonly error?: string;
}

export class ManifestUpdateCheck {
  constructor(
    private readonly probe: CachedProbe,
    private readonly git: Git,
  ) {}

  async execute(input: ManifestUpdateInput, signal?: AbortSignal): Promise<ManifestVerdict> {
    const skipped: ManifestVerdict = {
      workspace: input.workspace,
      upstream: null,
      fetched: null,
      behind: false,
      source: 'skipped',
    };
    if (!(await this.hasUpstream(input.sourceDir, signal))) return skipped;
    const probed = await this.probe.run(
      manifestUpdateKey(input.workspace),
      MANIFEST_UPDATE_TTL_MS,
      () => this.heads(input.sourceDir, signal),
      { isValue: isHeads, force: input.force, signal },
    );
    const heads = probed.value;
    return {
      ...skipped,
      upstream: heads?.upstream ?? null,
      fetched: heads?.fetched ?? null,
      behind: heads !== undefined && heads.upstream !== heads.fetched,
      source: probed.source,
      ...(probed.error === undefined ? {} : { error: probed.error }),
    };
  }

  // After a refresh: what was just fetched is what upstream has.
  async markCurrent(workspace: string, sourceDir: string): Promise<void> {
    const fetched = await this.fetchedSha(sourceDir);
    if (fetched === undefined) return;
    const heads: Heads = { upstream: fetched, fetched };
    await this.probe.remember(manifestUpdateKey(workspace), MANIFEST_UPDATE_TTL_MS, heads);
  }

  private async hasUpstream(sourceDir: string, signal?: AbortSignal): Promise<boolean> {
    return (await this.git.remotes(sourceDir, signal))['upstream'] !== undefined;
  }

  private async heads(sourceDir: string, signal?: AbortSignal): Promise<Heads> {
    const head = await this.git.askRemoteHead(sourceDir, 'upstream', PROBE_TIMEOUT_MS, signal);
    if (head === undefined)
      throw new DevkitError('network', 'MANIFEST_UPSTREAM_UNAVAILABLE', 'upstream did not answer');
    const fetched = await this.fetchedSha(sourceDir, head.branch, signal);
    if (fetched === undefined)
      throw new DevkitError(
        'config',
        'MANIFEST_REF_UNKNOWN',
        'The default branch of upstream is not known here',
      );
    return { upstream: head.sha, fetched };
  }

  private async fetchedSha(
    sourceDir: string,
    branch?: string,
    signal?: AbortSignal,
  ): Promise<string | undefined> {
    const known = branch ?? (await this.git.remoteHead(sourceDir, 'upstream', signal));
    return known === undefined ? undefined : this.git.sha(sourceDir, `upstream/${known}`, signal);
  }
}

const SHA = /^[0-9a-f]{40,64}$/;

function isHeads(value: unknown): value is Heads {
  const heads = value as Partial<Heads> | null;
  return [heads?.upstream, heads?.fetched].every((v) => typeof v === 'string' && SHA.test(v));
}
