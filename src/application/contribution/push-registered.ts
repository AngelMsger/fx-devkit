// Push the source of the workspace a command selected. What the command line left
// out is asked first. Only the registry is read before Git, and the code host is the
// one the committed baseline binds, never what a dirty working tree says.

import { DevkitError } from '../../domain/errors.js';
import { MANIFEST_FILES } from '../../domain/manifest/files.js';
import { loadWorkspace } from '../../domain/manifest/loader.js';
import {
  bindProviders,
  codeHostBinding,
  type Binding,
  type ProviderCatalog,
} from '../../domain/manifest/providers.js';
import type { Workspace } from '../../domain/manifest/types.js';
import type { Git } from '../../ports/git.js';
import type { ManifestSource } from '../../ports/manifest-source.js';
import { resolveWorkspace, type ResolveInput } from '../workspace/resolve.js';

import { CollectContributionInput, type SuppliedContributionInput } from './collect-input.js';
import type { ContributionHost, PushSourceDeps, PushSourceOutput } from './push-types.js';
import { PushSource } from './push.js';

type LocatedSource = Pick<PushSourceDeps, 'registration' | 'source'>;

export interface PushRegisteredSourceDeps {
  readonly resolve: ResolveInput;
  readonly git: Pick<Git, 'isToplevel'>;
  readonly sourceFor: (spec: string) => Promise<Pick<ManifestSource, 'kind'>>;
  readonly providers: ProviderCatalog;
  readonly codeHost: (binding: Binding) => ContributionHost;
  readonly validatorAt: (sourceDir: string) => PushSourceDeps['validator'];
  readonly push: Omit<PushSourceDeps, keyof LocatedSource | 'hostFor' | 'validator'>;
}

export class PushRegisteredSource {
  constructor(private readonly deps: PushRegisteredSourceDeps) {}

  async execute(supplied: SuppliedContributionInput): Promise<PushSourceOutput> {
    const { push, validatorAt } = this.deps;
    const input = await new CollectContributionInput(push.prompter).execute(supplied);
    const located = await this.locate();
    return new PushSource({
      ...push,
      ...located,
      validator: validatorAt(located.source.dir),
      hostFor: (baseFiles) => this.committedHost(baseFiles, input.cliVersion),
    }).execute(input);
  }

  // A contribution leaves from the registration's own checkout: a copied directory or
  // stdin text has no remotes, and a link would publish someone else's repository.
  private async locate(): Promise<LocatedSource> {
    const { resolve, git, sourceFor } = this.deps;
    const { config, fs, commandShell } = resolve;
    const located = await resolveWorkspace(resolve);
    const expected = (await config.read()).workspaces?.[located.name];
    if (!expected?.source) throw notOwnCheckout();
    const { kind } = await sourceFor(expected.source);
    if (kind !== 'repo' || (await fs.readLink(located.manifestDir)) !== undefined)
      throw notOwnCheckout();
    const dir = await fs.realpath(located.manifestDir);
    if (!(await git.isToplevel(dir))) throw notOwnCheckout();
    return {
      registration: {
        expected,
        physicalRoot: located.root,
        logicalSourceDir: located.manifestDir,
        config,
        fs,
        commandShell,
      },
      source: { workspace: located.name, dir, kind },
    };
  }

  private committedHost(
    baseFiles: Readonly<Record<string, string>>,
    cliVersion: string,
  ): ContributionHost {
    const { providers, codeHost } = this.deps;
    const workspace = committedWorkspace(baseFiles, { cliVersion, providers });
    return codeHost(codeHostBinding(bindProviders(workspace, providers)));
  }
}

function committedWorkspace(
  baseFiles: Readonly<Record<string, string>>,
  options: { readonly cliVersion: string; readonly providers: ProviderCatalog },
): Workspace {
  try {
    return loadWorkspace(baseFiles[MANIFEST_FILES.workspace] ?? '', { ...options, strict: true })
      .doc;
  } catch {
    throw new DevkitError(
      'config',
      'SOURCE_BASE_MANIFEST_INVALID',
      'The committed source cannot supply valid provider configuration',
      {
        nextSteps: [
          'fx manifest validate',
          'Fix the committed manifest on the upstream default branch before contributing.',
        ],
      },
    );
  }
}

function notOwnCheckout(): DevkitError {
  return new DevkitError(
    'config',
    'SOURCE_NOT_GIT',
    'The registered source must be its own Git checkout, not a directory source or foreign link',
    { nextSteps: ['Register the workspace from its manifest repository URL.'] },
  );
}
