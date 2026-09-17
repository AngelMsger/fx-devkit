// A repository's page on the code host. This answers with the URL; opening it is
// the CLI's business, and a repository with no page is a config error rather
// than an empty answer.

import { DevkitError } from '../../domain/errors.js';
import type { WorkspaceDeps } from '../workspace/deps.js';
import { workspaceCommand } from '../workspace/guidance.js';
import { findRepo, webUrlFor } from '../workspace/inspect.js';

export class RepoOpen {
  constructor(private readonly deps: WorkspaceDeps) {}

  execute(input: { readonly name: string }): { name: string; url: string } {
    const repo = findRepo(this.deps, input.name);
    const url = webUrlFor(this.deps, repo);
    if (url === undefined) {
      throw new DevkitError(
        'config',
        'REPO_NO_URL',
        `"${repo.name}" has no code-host location to open`,
        {
          nextSteps: [
            workspaceCommand(this.deps, 'manifest', 'providers'),
            workspaceCommand(this.deps, 'repo', 'show', repo.name),
          ],
        },
      );
    }
    return { name: repo.name, url };
  }
}
