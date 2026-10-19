// Supply only evidence-backed provider identification for manifest import.

import { identifyGitHubRemote } from '../adapters/code-host/github/import.js';
import { identifyLocalGitRemote } from '../adapters/code-host/local-git/import.js';
import type { ImportDeps } from '../application/manifest/import.js';
import type { ResolvedShell } from '../domain/shell.js';
import type { Reporter } from '../ports/reporter.js';

import { codeHostFor, type Container } from './container.js';

export function importDeps(
  container: Container,
  invocation: { readonly reporter: Reporter; readonly commandShell: ResolvedShell },
): ImportDeps {
  return {
    ...invocation,
    git: container.git,
    fs: container.fs,
    codeHost: (host) => codeHostFor(container, host),
    identifyProvider: async (upstream) =>
      identifyGitHubRemote(upstream) ?? (await identifyLocalGitRemote(container.process, upstream)),
  };
}
