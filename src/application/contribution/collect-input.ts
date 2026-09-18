// Missing contribution inputs are questions, never an implicit all-files
// selection. A prompter without a person returns INPUT_REQUIRED.

import { DevkitError } from '../../domain/errors.js';
import type { Prompter } from '../../ports/prompter.js';

import type { PushSourceInput } from './push-types.js';

export interface SuppliedContributionInput extends Omit<PushSourceInput, 'issue' | 'title'> {
  readonly issue: string | undefined;
  readonly title: string | undefined;
}

export class CollectContributionInput {
  constructor(private readonly prompter: Prompter) {}

  async execute(input: SuppliedContributionInput): Promise<PushSourceInput> {
    const paths = input.paths.length
      ? input.paths
      : parseSelection(
          await this.prompter.ask(
            'Source-relative paths (comma-separated or a JSON string array):',
          ),
        );
    const issue = input.issue ?? (await this.prompter.ask('Issue ID for the contribution commit:'));
    const title = input.title ?? (await this.prompter.ask('Pull request title:'));
    return { ...input, paths: [...new Set(paths)], issue: issue.trim(), title: title.trim() };
  }
}

function parseSelection(text: string): readonly string[] {
  const trimmed = text.trim();
  if (!trimmed.startsWith('['))
    return trimmed
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean);
  try {
    const value: unknown = JSON.parse(trimmed);
    if (Array.isArray(value) && value.every((item) => typeof item === 'string' && item.trim()))
      return value;
  } catch {
    /* Malformed selection never falls back to all changed files. */
  }
  throw new DevkitError(
    'usage',
    'SOURCE_SELECTION_INVALID',
    'Enter source paths as a comma-separated list or JSON string array',
    {
      nextSteps: [
        'Enter manifest/workspace.yaml,manifest/environments.yaml or ["manifest/workspace.yaml"].',
      ],
    },
  );
}
