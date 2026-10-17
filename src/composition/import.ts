// Supply only evidence-backed provider identification for manifest import.

import { identifyGitHubRemote } from '../adapters/code-host/github/import.js';
import { identifyLocalGitRemote } from '../adapters/code-host/local-git/import.js';
import type { ImportDeps } from '../application/manifest/import.js';
import type { Reporter } from '../ports/reporter.js';

import { codeHostFor, type Container } from './container.js';

export function importDeps(container: Container, reporter: Reporter): ImportDeps {
  return {
    git: container.git,
    fs: container.fs,
    reporter,
    codeHost: (host) => codeHostFor(container, host),
    identifyProvider: async (upstream) =>
      identifyGitHubRemote(upstream) ?? (await identifyLocalGitRemote(container.process, upstream)),
  };
}
