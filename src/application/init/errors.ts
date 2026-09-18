// What initialization says when it cannot continue. A failure reports how far it
// got, because a registered workspace is inspected and retried differently from
// one that never reached its source.

import { asDevkitError, DevkitError, toEnvelope, withPartialResult } from '../../domain/errors.js';
import { shellLine } from '../../domain/shell.js';
import type { ManifestSource, ManifestSourceInspection } from '../../ports/manifest-source.js';
import type { WorkspaceEntry } from '../../ports/stores.js';
import { sourceValidationError } from '../manifest/source-error.js';
import type { ToolInstallOutput } from '../tool/install.js';

import type { InitDeps, InitInput, InitOutput } from './types.js';

const PHASES = ['manifest', 'validation', 'registration', 'tools', 'sync'];

export function nameTaken(
  name: string,
  root: string,
  existing: WorkspaceEntry,
  source: ManifestSource,
): DevkitError {
  return new DevkitError(
    'conflict',
    'WORKSPACE_NAME_TAKEN',
    `Workspace "${name}" is already registered at ${existing.root}`,
    {
      hint: 'If the directory moved, relocate its existing identity; otherwise initialize the registered directory.',
      nextSteps: [
        shellLine(['fx', 'workspace', 'relocate', name, root]),
        shellLine(['fx', 'init', existing.root, '--name', name, '--from', source.description]),
      ],
    },
  );
}

export function sourceMismatch(
  name: string,
  recorded: string,
  source: ManifestSource,
): DevkitError {
  return new DevkitError(
    'conflict',
    'SOURCE_MISMATCH',
    `Workspace "${name}" takes its manifest from ${recorded}, not ${source.description}`,
    {
      hint: 'Use workspace rebind to replace the source while preserving identity and local scope.',
      nextSteps: [
        shellLine(['fx', 'workspace', 'rebind', name, '--from', source.description]),
        shellLine(['fx', 'workspace', 'show', name]),
      ],
    },
  );
}

export function initializationSourceError(
  deps: Pick<InitDeps, 'commandShell'>,
  input: InitInput,
  output: Pick<InitOutput, 'name' | 'root'>,
  inspected: Pick<ManifestSourceInspection, 'root' | 'contents'> | undefined,
  error: unknown,
): DevkitError {
  let selection: string[] = [];
  if (input.repos !== undefined)
    selection = input.repos.length === 0 ? ['--no-repos'] : ['--repos', input.repos.join(',')];
  return sourceValidationError(error, {
    source: input.source,
    inspected,
    commandShell: deps.commandShell,
    retry: [
      'fx',
      'init',
      output.root,
      '--name',
      output.name,
      '--from',
      input.source.description,
      ...selection,
      '--dry-run',
    ],
  });
}

export interface InitProgress {
  readonly phase: string;
  readonly registered: boolean;
  readonly materialized: boolean;
  readonly prepared: object | null;
  readonly toolInstall: readonly ToolInstallOutput[] | null;
}

export function initFailure(
  output: InitOutput,
  error: unknown,
  progress: InitProgress,
): DevkitError {
  const failure = asDevkitError(error);
  const { phase, registered, materialized, prepared, toolInstall } = progress;
  const failedAt = PHASES.indexOf(phase);
  const phases = Object.fromEntries(
    PHASES.map((name, index) => {
      if (index < failedAt) return [name, 'done'];
      return [name, index === failedAt ? 'failed' : 'not_started'];
    }),
  );
  const install = failure.partialResult as
    { tool_install?: readonly ToolInstallOutput[] } | undefined;
  return withPartialResult(failure, {
    ...output,
    preparation_complete: false,
    manifest: materialized ? output.manifest : 'not_written',
    registered,
    written: materialized,
    prepared,
    tool_install: toolInstall ?? install?.tool_install ?? null,
    sync: phase === 'sync' ? (failure.partialResult ?? null) : null,
    phases,
    failed_phase: phase,
    failure: toEnvelope(failure).error,
    next_steps: registered
      ? [
          ...failure.nextSteps,
          `Inspect remaining stages with fx status --workspace ${output.name} --format json.`,
        ]
      : [
          'Correct the reported source problem and retry the same init command.',
          ...failure.nextSteps,
        ],
  });
}
