// Read pinned version-field history for any known repository, independent of whether
// the shared release checklist covers it. No publication policy is inferred here.

import { DevkitError } from '../../domain/errors.js';
import type { BaselineEvidence, VersionEvidence } from '../../domain/release/version-evidence.js';
import { repoRef } from '../../domain/workspace/ref.js';
import type { LoginDeps } from '../login/deps.js';
import { readBaseline } from '../release/baseline.js';
import { rememberCodeHost } from '../release/facts.js';
import { Gates } from '../release/gates.js';
import { validateVersionPath } from '../release/version-declaration.js';
import { readVersionHistory } from '../release/version-history.js';
import type { WorkspaceDeps } from '../workspace/deps.js';
import { findKnownRepo } from '../workspace/inspect.js';

export interface RepoVersionInput {
  readonly name: string;
  readonly ref?: string | undefined;
  readonly path?: string | undefined;
  readonly baseline?: string | undefined;
  readonly historyLimit?: number | undefined;
}

export interface RepoVersionResult {
  readonly name: string;
  readonly observed_at: string;
  readonly version_evidence: VersionEvidence;
  readonly baseline_evidence: BaselineEvidence | null;
  readonly evidence_complete: boolean;
}

export class RepoVersion {
  constructor(
    private readonly deps: WorkspaceDeps,
    private readonly login: LoginDeps,
  ) {}

  async execute(input: RepoVersionInput): Promise<RepoVersionResult> {
    if (input.path !== undefined) validateVersionPath(input.path);
    const repo = findKnownRepo(this.deps, input.name);
    const ref = repoRef(repo);
    if (ref === undefined)
      throw new DevkitError(
        'config',
        'REPO_NO_CODE_HOST',
        'The repository has no code-host reference',
        {
          nextSteps: ['Inspect fx repo show and the shared repository coordinate.'],
        },
      );
    const observedAt = this.login.clock.now().toISOString();
    await this.requireReady();
    const host = rememberCodeHost(this.deps.codeHost());
    const requested =
      input.ref ?? repo.branch ?? (await host.branches(ref)).find((branch) => branch.default)?.name;
    if (requested === undefined)
      throw new DevkitError(
        'usage',
        'VERSION_REF_REQUIRED',
        'No default version ref is available',
        {
          nextSteps: ['Pass --ref with a branch, tag or commit.'],
        },
      );
    const version = await readVersionHistory({
      host,
      ref,
      requestedRef: requested,
      ...(input.path === undefined ? {} : { path: input.path }),
      ...(input.historyLimit === undefined ? {} : { maxCommits: input.historyLimit }),
    });
    const baseline =
      input.baseline === undefined
        ? null
        : await readBaseline({
            host,
            ref,
            baselineRef: input.baseline,
            headRef: requested,
            ...(version.resolved_sha === null ? {} : { headSha: version.resolved_sha }),
            ...(input.path === undefined ? {} : { path: input.path }),
          });
    return {
      name: repo.name,
      observed_at: observedAt,
      version_evidence: version,
      baseline_evidence: baseline,
      evidence_complete:
        version.coverage === 'checked' && (baseline === null || baseline.coverage === 'checked'),
    };
  }

  private async requireReady(): Promise<void> {
    const gate = await new Gates(this.deps, this.login).through('code-host', undefined);
    if (!gate.open) {
      const handoff = gate.verdict?.handoff;
      throw new DevkitError(
        'incomplete',
        'VERSION_EVIDENCE_UNAVAILABLE',
        'Code-host version evidence is not ready',
        {
          hint: gate.reason,
          ...(handoff === null || handoff === undefined
            ? {}
            : {
                handoff: {
                  summary: handoff.summary,
                  userSteps: handoff.user_steps,
                  ...(handoff.command === undefined ? {} : { command: handoff.command }),
                  ...(handoff.alternatives === undefined
                    ? {}
                    : { alternatives: handoff.alternatives }),
                },
              }),
          nextSteps: [gate.verdict?.handoff?.command ?? 'fx can code-host'],
        },
      );
    }
  }
}
