// Workspace recovery commands retain the resolved identity instead of resolving cwd or defaults again.

import { DevkitError } from '../../domain/errors.js';
import { nearest, suggestionHint } from '../../domain/fuzzy.js';
import { shellLine, type ResolvedShell } from '../../domain/shell.js';

export interface WorkspaceGuidance {
  readonly ctx: { readonly name: string };
  readonly commandShell?: ResolvedShell | undefined;
}

export interface CommandGuidance {
  readonly workspace?: string | undefined;
  readonly commandShell?: ResolvedShell | undefined;
}

export function recoveryCommand(context: CommandGuidance, ...args: readonly string[]): string {
  const scope = context.workspace === undefined ? [] : ['--workspace', context.workspace];
  return shellLine(['fx', ...args, ...scope], context.commandShell);
}

export function workspaceCommand(context: WorkspaceGuidance, ...args: readonly string[]): string {
  return recoveryCommand(
    { workspace: context.ctx.name, commandShell: context.commandShell },
    ...args,
  );
}

export function workspaceItemNotFound(
  context: WorkspaceGuidance,
  input: {
    readonly kind: 'repo' | 'env';
    readonly name: string;
    readonly known: readonly string[];
    readonly shared?: boolean;
  },
): DevkitError {
  const suggestion = nearest(input.name, input.known);
  const subject = input.kind === 'repo' ? 'repository' : 'environment';
  const qualifier = input.shared ? 'shared ' : '';
  const article = input.kind === 'env' ? 'an' : 'a';
  return new DevkitError(
    'not_found',
    input.kind === 'repo' ? 'REPO_NOT_FOUND' : 'ENV_NOT_FOUND',
    `"${input.name}" is not ${article} ${qualifier}${subject} of workspace "${context.ctx.name}"`,
    {
      hint: suggestionHint(suggestion, `Known: ${input.known.join(', ') || '(none)'}.`),
      nextSteps: [workspaceCommand(context, input.kind, 'list')],
    },
  );
}
