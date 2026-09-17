// Source validation failures identify the bytes inspected and repeat the source-specific operation.

import { asDevkitError, DevkitError } from '../../domain/errors.js';
import { shellLine, type ResolvedShell } from '../../domain/shell.js';
import type { ManifestSource, ManifestSourceInspection } from '../../ports/manifest-source.js';

export interface SourceErrorContext {
  readonly source: Pick<ManifestSource, 'description' | 'kind'>;
  readonly inspected?: Pick<ManifestSourceInspection, 'root' | 'contents'> | undefined;
  readonly retry: readonly string[];
  readonly commandShell?: ResolvedShell | undefined;
  readonly preservedWorkspace?: string;
}

export function sourceValidationError(error: unknown, context: SourceErrorContext): DevkitError {
  const failure = asDevkitError(error);
  const location = context.inspected?.root ?? context.source.description;
  const preserved =
    context.preservedWorkspace === undefined
      ? ''
      : ` Workspace "${context.preservedWorkspace}" still uses its registered source.`;
  return new DevkitError(
    failure.category,
    failure.code,
    `${failure.message}\nCandidate source: ${context.source.description}.${context.inspected === undefined ? '' : ` Inspected source: ${location}.`}`,
    {
      hint: `${correction(context, location)}${preserved} ${failure.hint}`,
      nextSteps: [shellLine(context.retry, context.commandShell)],
      retryable: failure.retryable,
      cause: failure,
      diagnostics: failure.diagnostics,
      ...(failure.handoff === undefined ? {} : { handoff: failure.handoff }),
      ...(failure.partialResult === undefined ? {} : { partialResult: failure.partialResult }),
    },
  );
}

function correction(context: SourceErrorContext, location: string): string {
  if (context.inspected?.contents === 'commit')
    return `Correct and commit the candidate manifest in its repository; this check read committed contents at ${location}.`;
  if (context.inspected?.contents === 'worktree')
    return `Correct the retained managed worktree at ${location}; refresh currently preserves those local contents.`;
  if (context.source.kind === 'stdin')
    return 'Correct the supplied stdin content and provide it again when retrying.';
  return `Correct the candidate manifest from ${context.source.description}, then repeat its preview.`;
}
