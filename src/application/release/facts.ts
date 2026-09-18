// What every code-host-backed check needs to know about one repository,
// fetched once: where it lives, which branches it has, and which of them
// are the release's source and target. Not knowing is an outcome the checks
// turn into findings, never an exception that stops the report.

import { asDevkitError } from '../../domain/errors.js';
import type { ResolvedRepo } from '../../domain/manifest/local.js';
import type { Members } from '../../domain/manifest/types.js';
import type { ReleasePolicy } from '../../domain/release/policy.js';
import { unanswered, type Check, type ReleaseFinding } from '../../domain/release/types.js';
import type { Branch } from '../../domain/workspace/commits.js';
import { repoRef, type RepoRef } from '../../domain/workspace/ref.js';
import type { CodeHostQueries } from '../../ports/code-host.js';
import type { WorkspaceDeps } from '../workspace/deps.js';

import { blockedFinding, type Gate, type Gates } from './gates.js';

// A check reads the manifest, asks a platform, and reads a repository: it
// is handed those three and not the git, filesystem or subprocess ports
// that would let it write.
export type ReleaseDeps = Pick<WorkspaceDeps, 'ctx' | 'platform'> & {
  readonly codeHost: () => CodeHostQueries;
};

export interface CheckContext {
  readonly deps: ReleaseDeps;
  readonly gates: Gates;
  readonly repo: ResolvedRepo;
  readonly policy: ReleasePolicy;
  readonly members: Members | undefined;
  readonly now: Date;
}

export interface RepoFacts {
  readonly host: CodeHostQueries;
  readonly ref: RepoRef;
  readonly branches: readonly Branch[];
  readonly source: Branch | undefined;
  readonly target: Branch | undefined;
}

export type FactsOutcome =
  | { readonly kind: 'facts'; readonly facts: RepoFacts }
  | { readonly kind: 'gate'; readonly gate: Gate & { open: false } }
  | { readonly kind: 'error'; readonly reason: string };

export async function gatherFacts(ctx: CheckContext): Promise<FactsOutcome> {
  const gate = await ctx.gates.through('code-host', undefined);
  if (!gate.open) return { kind: 'gate', gate };
  const ref = repoRef(ctx.repo);
  if (ref === undefined)
    return { kind: 'error', reason: 'no code-host reference: neither a project nor an upstream' };
  try {
    const host = ctx.deps.codeHost();
    const branches = await host.branches(ref);
    const named = (name: string | undefined): Branch | undefined =>
      name === undefined ? undefined : branches.find((b) => b.name === name);
    const source = named(ctx.policy.source);
    // The first candidate the repository has, in the manifest's order; a
    // repository releasing from that branch has no target to compare with.
    const candidate = ctx.policy.targets.map(named).find((b) => b !== undefined);
    const target = candidate?.name === source?.name ? undefined : candidate;
    return { kind: 'facts', facts: { host, ref, branches, source, target } };
  } catch (err) {
    return { kind: 'error', reason: asDevkitError(err).message };
  }
}

// The finding a check makes when the facts never arrived.
export function withoutFacts(
  check: Check,
  repo: string,
  outcome: Exclude<FactsOutcome, { kind: 'facts' }>,
): ReleaseFinding {
  return outcome.kind === 'gate'
    ? blockedFinding(check, repo, outcome.gate)
    : unanswered(check, repo, outcome.reason);
}

// A check's own failure is its finding: the report goes on.
export async function attempt(
  check: Check,
  repo: string,
  run: () => Promise<ReleaseFinding>,
): Promise<ReleaseFinding> {
  try {
    return await run();
  } catch (err) {
    return unanswered(check, repo, asDevkitError(err).message);
  }
}
