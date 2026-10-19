// The ports of a source contribution: Git plumbing and transport for the source
// checkout, the personal journal, and candidate validation over captured bytes.

import { randomUUID } from 'node:crypto';

import { SnapshotReader } from '../adapters/fs/snapshot-reader.js';
import { ContributionSystemGit } from '../adapters/git/contribution-system-git.js';
import { ContributionGitTransport } from '../adapters/git/contribution-transport.js';
import type { PushRegisteredSourceDeps } from '../application/contribution/push-registered.js';
import type { ContributionHost } from '../application/contribution/push-types.js';
import { ValidateContribution } from '../application/contribution/validate.js';
import type { ResolveInput } from '../application/workspace/resolve.js';
import { FileContributionStore } from '../infra/contribution-store.js';

import type { Container } from './container.js';
import { manifestSourceFor } from './manifest-sources.js';
import { resolveProvider } from './registry.js';

interface SourceCommand {
  readonly container: Container;
  readonly resolve: ResolveInput;
  readonly noInput: boolean;
  readonly user: string | undefined;
}

export function sourcePushDeps(input: SourceCommand): PushRegisteredSourceDeps {
  const { container } = input;
  const adapters = { process: container.process, fs: container.fs, clock: container.clock };
  return {
    resolve: input.resolve,
    git: container.git,
    sourceFor: (spec) => manifestSourceFor(spec, container, async () => ''),
    providers: container.providers,
    codeHost: (binding) => resolveProvider<ContributionHost>(binding, adapters),
    validatorAt: (dir) =>
      new ValidateContribution(
        { open: (files) => ({ root: dir, reader: new SnapshotReader({ root: dir, files }) }) },
        container.bundledTools,
        container.providers,
        container.describeProvider,
      ),
    push: {
      user: input.user,
      prompter: container.prompter(input.noInput),
      git: new ContributionSystemGit(container.process),
      transport: new ContributionGitTransport(container.process),
      records: new FileContributionStore(container.fxHome, container.lock),
      ids: { next: randomUUID },
      clock: container.clock,
      lock: container.lock,
    },
  };
}
