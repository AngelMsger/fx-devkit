// Manifest import knows one provider before any workspace exists: the one that reads
// repositories kept under a local directory. It also identifies that provider's remotes.

import { identifyGitHubRemote } from '../adapters/code-host/github/import.js';
import { identifyLocalGitRemote } from '../adapters/code-host/local-git/import.js';
import type { ImportDeps } from '../application/manifest/import.js';
import type { ResolvedShell } from '../domain/shell.js';
import type { CodeHost } from '../ports/code-host.js';
import type { Reporter } from '../ports/reporter.js';

import type { Container } from './container.js';
import { resolveProvider } from './registry.js';

export function importDeps(
  container: Container,
  invocation: { readonly reporter: Reporter; readonly commandShell: ResolvedShell },
): ImportDeps {
  return {
    ...invocation,
    git: container.git,
    fs: container.fs,
    localCodeHost: (host) =>
      resolveProvider<CodeHost>(
        { capability: 'code-host', provider: 'local-git', source: 'default', vars: { host } },
        { process: container.process, fs: container.fs, clock: container.clock },
      ),
    identifyProvider: async (upstream) =>
      identifyGitHubRemote(upstream) ?? (await identifyLocalGitRemote(container.process, upstream)),
  };
}
