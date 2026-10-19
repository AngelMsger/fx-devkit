// What initialization says when it cannot continue. A failure reports how far it
// got, because a registered workspace is inspected and retried differently from
// one that never reached its source.

import { asDevkitError, DevkitError, toEnvelope, withPartialResult } from '../../domain/errors.js';
import {
  preparation,
  preparationCheck,
  type Preparation,
  type PreparationAction,
} from '../../domain/preparation.js';
import { shellLine } from '../../domain/shell.js';
import type { ManifestSourceInspection } from '../../ports/manifest-source.js';
import type { WorkspaceEntry } from '../../ports/stores.js';
import { sourceValidationError } from '../manifest/source-error.js';
import { resumeAction } from '../preparation.js';
import type { ToolInstallOutput } from '../tool/install.js';

import { sourceIdentity } from './source.js';
import type { InitDeps, InitInput, InitOutput } from './types.js';

const PHASES = ['manifest', 'validation', 'registration', 'tools', 'sync'] as const;
export type InitPhase = (typeof PHASES)[number];

type Guidance = Pick<InitDeps, 'commandShell'>;

export function nameTaken(
  deps: Guidance,
  name: string,
  root: string,
  existing: WorkspaceEntry,
): DevkitError {
  return new DevkitError(
    'conflict',
    'WORKSPACE_NAME_TAKEN',
    `Workspace "${name}" is already registered at ${existing.root}`,
    {
      hint: 'The existing workspace is unchanged. Omit --name to let fx choose an available registration name.',
      nextSteps: [
        shellLine(['fx', 'workspace', 'show', name], deps.commandShell),
        `Retry initialization at ${root} without --name or with an unused name, keeping the original source and repository selection.`,
      ],
    },
  );
}

export function sourceMismatch(
  deps: Guidance,
  name: string,
  recorded: string,
  candidate: string,
): DevkitError {
  return new DevkitError(
    'conflict',
    'SOURCE_MISMATCH',
    `Workspace "${name}" takes its manifest from ${recorded}, not ${candidate}`,
    {
      hint: 'Use workspace rebind to replace the source while preserving identity and local scope.',
      nextSteps: [
        shellLine(['fx', 'workspace', 'rebind', name, '--from', candidate], deps.commandShell),
        shellLine(['fx', 'workspace', 'show', name], deps.commandShell),
      ],
    },
  );
}

export function initializationSourceError(
  deps: Guidance,
  input: InitInput,
  output: Pick<InitOutput, 'name' | 'root'>,
  inspected: Pick<ManifestSourceInspection, 'root' | 'contents'> | undefined,
  error: unknown,
): DevkitError {
  let selection: string[] = [];
  if (input.repos !== undefined)
    selection = input.repos.length === 0 ? ['--no-repos'] : ['--repos', input.repos.join(',')];
  const source = sourceIdentity(input.source);
  return sourceValidationError(error, {
    source,
    inspected,
    commandShell: deps.commandShell,
    retry: [
      'fx',
      'init',
      ...(input.source.kind === 'kept'
        ? ['--resume', '--workspace', output.name]
        : [output.root, '--name', output.name, '--from', source.description, ...selection]),
      '--dry-run',
    ],
  });
}

export interface InitProgress {
  readonly cwd: string;
  readonly phase: InitPhase;
  readonly registered: boolean;
  readonly materialized: boolean;
  readonly prepared: object | null;
  readonly toolInstall: readonly ToolInstallOutput[] | null;
}

export function initFailure(
  deps: Guidance,
  output: InitOutput,
  error: unknown,
  progress: InitProgress,
): DevkitError {
  const failure = asDevkitError(error);
  const { phase, registered, materialized, prepared, toolInstall } = progress;
  const resumable =
    registered && (output.plan.manifest_action === 'keep' || phase === 'tools' || phase === 'sync');
  const phases = phaseResults(progress);
  const install = failure.partialResult as
    { tool_install?: readonly ToolInstallOutput[] } | undefined;
  const observed = (failure.partialResult as { preparation?: Preparation } | undefined)
    ?.preparation;
  const priorChecks = observed
    ? [
        ...observed.completed.map((id) =>
          preparationCheck(id, 'ready', 'Completed before the failure'),
        ),
        ...observed.blockers,
        ...observed.warnings,
      ]
    : [];
  const recovery = initializationRecovery(output, progress, resumable);
  const result = preparation({
    scope: observed?.scope ?? output.preparation.scope,
    checks: [
      ...priorChecks,
      preparationCheck(phase, 'blocked', failure.message, {
        code: failure.code,
        failure: toEnvelope(failure).error,
        owner: phase === 'validation' ? 'maintainer' : 'user',
      }),
    ],
    resume: recovery,
  });
  return withPartialResult(failure, {
    ...output,
    preparation: result,
    manifest: materialized ? output.manifest : 'not_written',
    registered,
    written: materialized,
    prepared,
    tool_install: toolInstall ?? install?.tool_install ?? null,
    sync: synchronizationResult(failure, phase),
    phases,
    failed_phase: phase,
    failure: toEnvelope(failure).error,
    ...(phase === 'validation' ? { validation: failure.partialResult } : {}),
    next_steps: resumable
      ? [...failure.nextSteps, shellLine(recovery.argv, deps.commandShell)]
      : [
          'Correct the reported source problem and retry the same init command.',
          ...failure.nextSteps,
        ],
  });
}

function initializationRecovery(
  output: InitOutput,
  progress: InitProgress,
  resumable: boolean,
): PreparationAction {
  if (resumable)
    return resumeAction({
      workspace: output.name,
      cwd: progress.cwd,
      description: 'Continue preparing this workspace',
    });
  let selection: string[] = [];
  if (output.plan.selection.repos) selection = ['--repos', output.plan.selection.repos.join(',')];
  if (output.plan.selection.mode === 'none') selection = ['--no-repos'];
  return {
    id: 'retry-initialization',
    description: 'Retry after correcting the source',
    argv: ['fx', 'init', output.root, '--name', output.name, '--from', output.source, ...selection],
    cwd: progress.cwd,
    actor: 'agent',
    requires_approval: false,
  };
}

function phaseResults(progress: InitProgress): Record<string, string> {
  const failedAt = PHASES.indexOf(progress.phase);
  const phases = Object.fromEntries(
    PHASES.map((name, index) => {
      if (index < failedAt) return [name, 'done'];
      return [name, index === failedAt ? 'failed' : 'not_started'];
    }),
  );
  if (!progress.materialized)
    phases['manifest'] = progress.phase === 'manifest' ? 'failed' : 'not_started';
  return phases;
}

// Init owns the single preparation verdict; nested synchronization retains only its evidence.
function synchronizationResult(failure: DevkitError, phase: InitPhase): object | null {
  if (phase !== 'sync' || !failure.partialResult) return null;
  return Object.fromEntries(
    Object.entries(failure.partialResult).filter(([key]) => key !== 'preparation'),
  );
}
