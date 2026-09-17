// Supply only evidence-backed provider identification for manifest import.

import { identifyLocalGitRemote } from '../adapters/code-host/local-git/import.js';
import type { ImportDeps } from '../application/import.js';
import type { Reporter } from '../ports/reporter.js';

import { codeHostFor, type Container } from './container.js';

export function importDeps(container: Container, reporter: Reporter): ImportDeps {
  return {
    git: container.git,
    fs: container.fs,
    reporter,
    codeHost: (host) => codeHostFor(container, host),
    identifyProvider: (upstream) => identifyLocalGitRemote(container.process, upstream),
  };
}
