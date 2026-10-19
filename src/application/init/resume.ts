// Continue preparing a registered workspace from what it already holds. The registration
// names the root and the recorded source, the managed directory is inspected as it
// stands and the personal selection is kept; nothing is imported again.

import type { ManifestSourceInspection } from '../../ports/manifest-source.js';
import type { WritePosture } from '../safety/posture.js';
import { explicitWorkspace } from '../workspace/resolve.js';

import type { InitDeps, InitOutput } from './types.js';

import { Init } from './index.js';

export interface ResumeInitDeps extends InitDeps {
  readonly inspectManaged: (manifestDir: string) => Promise<ManifestSourceInspection | undefined>;
}

export interface ResumeInitInput {
  // A registration name, or the root it is registered at.
  readonly workspace: string;
  readonly cwd: string;
  readonly dryRun: boolean;
  readonly posture: WritePosture;
  readonly jobs: number;
}

export class ResumeInit {
  constructor(private readonly deps: ResumeInitDeps) {}

  async execute(input: ResumeInitInput): Promise<InitOutput> {
    const { config, fs, manifestDirFor, inspectManaged, commandShell } = this.deps;
    const registry = (await config.read()).workspaces ?? {};
    const { name, entry } = await explicitWorkspace(
      input.workspace,
      input.cwd,
      registry,
      fs,
      commandShell,
    );
    return new Init(this.deps).execute({
      dir: entry.root,
      name,
      source: {
        kind: 'kept',
        recorded: entry.source,
        inspect: () => inspectManaged(manifestDirFor(name)),
      },
      adopt: false,
      dryRun: input.dryRun,
      posture: input.posture,
      jobs: input.jobs,
    });
  }
}
