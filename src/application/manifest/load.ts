// Reads the manifest documents of a manifest directory and runs them through the
// domain loaders. Only workspace.yaml is mandatory; the others are reported
// as absent rather than failing, and it is the caller's business whether
// absence matters.

import path from 'node:path';

import { DevkitError } from '../../domain/errors.js';
import {
  loadEnvironments,
  loadHarness,
  loadMembers,
  loadTools,
  loadWorkspace,
  type LoadOptions,
  type ToolsLoadResult,
} from '../../domain/manifest/loader.js';
import type {
  Environments,
  Harness,
  LoadResult,
  Members,
  Workspace,
} from '../../domain/manifest/types.js';
import type { DiagnosticReporter } from '../../ports/diagnostics.js';
import type { FileReader } from '../../ports/fs.js';

import { MANIFEST_FILES } from './locate.js';

export interface LoadedDocument<T> {
  readonly path: string;
  readonly result: LoadResult<T>;
}

export interface ManifestBundle {
  readonly dir: string;
  readonly workspace: LoadedDocument<Workspace>;
  readonly environments: LoadedDocument<Environments> | undefined;
  readonly tools: {
    readonly path: string | undefined;
    readonly patchText: string | undefined;
    readonly result: ToolsLoadResult;
  };
  readonly members: LoadedDocument<Members> | undefined;
  readonly harness: LoadedDocument<Harness> | undefined;
}

export interface LoadManifestInput extends LoadOptions {
  readonly dir: string;
}

export class LoadManifest {
  constructor(
    private readonly fs: Pick<FileReader, 'readText'>,
    private readonly bundledTools: () => string,
    private readonly diagnostics?: DiagnosticReporter,
  ) {}

  async execute(input: LoadManifestInput): Promise<ManifestBundle> {
    const { dir, ...opts } = input;
    const read = (file: string): Promise<string | undefined> =>
      this.fs.readText(path.join(dir, file));

    const workspaceText = (await read(MANIFEST_FILES.workspace)) ?? '';
    const workspace = {
      path: MANIFEST_FILES.workspace,
      result: this.load(dir, MANIFEST_FILES.workspace, () => loadWorkspace(workspaceText, opts)),
    };

    const environments = await this.optional(dir, MANIFEST_FILES.environments, (text) =>
      loadEnvironments(text, opts, { workspace: workspace.result.doc }),
    );
    const harness = await this.optional(dir, MANIFEST_FILES.harness, (text) =>
      loadHarness(text, opts),
    );

    const patchText = await read(MANIFEST_FILES.tools);
    const tools = {
      path: patchText === undefined ? undefined : MANIFEST_FILES.tools,
      patchText,
      result: this.load(dir, MANIFEST_FILES.tools, () =>
        loadTools(this.bundledTools(), patchText, opts),
      ),
    };

    const members = await this.optional(dir, MANIFEST_FILES.members, (text) =>
      loadMembers(text, opts),
    );
    return { dir, workspace, environments, tools, members, harness };
  }

  private async optional<T>(
    dir: string,
    file: string,
    load: (text: string) => LoadResult<T>,
  ): Promise<LoadedDocument<T> | undefined> {
    const text = await this.fs.readText(path.join(dir, file));
    if (text === undefined) return undefined;
    return { path: file, result: this.load(dir, file, () => load(text)) };
  }

  private load<T>(dir: string, file: string, load: () => T): T {
    try {
      return load();
    } catch (err) {
      if (err instanceof DevkitError) {
        for (const event of err.diagnostics)
          this.diagnostics?.emit({ ...event, file: path.join(dir, file) });
      }
      throw err;
    }
  }
}
