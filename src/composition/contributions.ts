// Source contributions resolve only registry identity before reading Git. The
// code-host provider is built from committed baseline bytes, not dirty source.

import { randomUUID } from 'node:crypto';

import { SnapshotReader } from '../adapters/fs/snapshot-reader.js';
import { ContributionSystemGit } from '../adapters/git/contribution-system-git.js';
import { ContributionGitTransport } from '../adapters/git/contribution-transport.js';
import {
  CollectContributionInput,
  type SuppliedContributionInput,
} from '../application/contribution/collect-input.js';
import type {
  ContributionHost,
  PushSourceDeps,
  PushSourceOutput,
} from '../application/contribution/push-types.js';
import { PushSource } from '../application/contribution/push.js';
import { ValidateContribution } from '../application/contribution/validate.js';
import { resolveWorkspace, type ResolveInput } from '../application/workspace/resolve.js';
import { DevkitError } from '../domain/errors.js';
import { MANIFEST_FILES } from '../domain/manifest/files.js';
import { loadWorkspace } from '../domain/manifest/loader.js';
import { bindProviders } from '../domain/manifest/providers.js';
import { FileContributionStore } from '../infra/contribution-store.js';

import type { Container } from './container.js';
import { manifestSourceFor } from './manifest-sources.js';
import { resolveProvider } from './registry.js';

interface SourceCommand {
  readonly container: Container;
  readonly resolve: ResolveInput;
  readonly noInput: boolean;
  readonly user: string | undefined;
  readonly request: SuppliedContributionInput;
}

export async function runSourcePush(input: SourceCommand): Promise<PushSourceOutput> {
  const prompter = input.container.prompter(input.noInput);
  const request = await new CollectContributionInput(prompter).execute(input.request);
  const deps = await sourceDeps(input);
  return new PushSource({ ...deps, prompter }).execute(request);
}

async function sourceDeps(input: SourceCommand): Promise<Omit<PushSourceDeps, 'prompter'>> {
  const { container } = input;
  const located = await resolveWorkspace(input.resolve);
  const entry = (await container.config.read()).workspaces?.[located.name];
  if (!entry) throw notGit();
  const source =
    entry?.source && (await manifestSourceFor(entry.source, container, async () => ''));
  if (!source || source.kind !== 'repo' || (await container.fs.readLink(located.manifestDir)))
    throw notGit();
  const dir = await container.fs.realpath(located.manifestDir);
  const top = await container.git.toplevel(dir);
  if (!top || (await container.fs.realpath(top)) !== dir) throw notGit();
  const validator = new ValidateContribution(
    { open: (files) => ({ root: dir, reader: new SnapshotReader({ root: dir, files }) }) },
    container.bundledTools,
    container.describeProvider,
  );
  return {
    user: input.user,
    registration: {
      expected: entry,
      physicalRoot: located.root,
      logicalSourceDir: located.manifestDir,
      config: container.config,
      fs: container.fs,
    },
    source: { workspace: located.name, dir, kind: 'repo' },
    git: new ContributionSystemGit(container.process),
    transport: new ContributionGitTransport(container.process),
    records: new FileContributionStore(container.fxHome, container.lock),
    ids: { next: randomUUID },
    clock: container.clock,
    lock: container.lock,
    validator,
    hostFor: (files) => codeHostFromBase(container, files, input.request.cliVersion),
  };
}

function codeHostFromBase(
  container: Container,
  files: Readonly<Record<string, string>>,
  cliVersion: string,
): ContributionHost {
  let workspace;
  try {
    workspace = loadWorkspace(files[MANIFEST_FILES.workspace] ?? '', {
      cliVersion,
      strict: true,
    }).doc;
  } catch {
    throw new DevkitError(
      'config',
      'SOURCE_BASE_MANIFEST_INVALID',
      'The committed source cannot supply valid provider configuration.',
      {
        nextSteps: [
          'fx manifest validate',
          'Fix the committed manifest on the upstream default branch before contributing.',
        ],
      },
    );
  }
  const binding = bindProviders(workspace).find((item) => item.capability === 'code-host')!;
  return resolveProvider<ContributionHost>(binding, {
    process: container.process,
    fs: container.fs,
    clock: container.clock,
  });
}

function notGit(): DevkitError {
  return new DevkitError(
    'config',
    'SOURCE_NOT_GIT',
    'The registered source must be its own Git checkout, not a directory source or foreign link.',
    { nextSteps: ['Register the workspace from its manifest repository URL.'] },
  );
}
