// `manifest validate`: every document, every problem, in one report. Loads
// with allowInvalid so nothing is dropped or thrown; a document that cannot
// even be parsed becomes one root-level problem.

import path from 'node:path';

import { asDevkitError } from '../../domain/errors.js';
import {
  loadEnvironments,
  loadHarness,
  loadMembers,
  loadTools,
  loadWorkspace,
  type InspectLoadOptions,
} from '../../domain/manifest/loader.js';
import type { ProviderCatalog } from '../../domain/manifest/providers.js';
import type {
  Dropped,
  InspectedLoadResult,
  Kind,
  Problem,
  Workspace,
} from '../../domain/manifest/types.js';
import type { FileReader } from '../../ports/fs.js';

import { MANIFEST_FILES } from './locate.js';

export type ValidatedKind = Exclude<Kind, 'local'>;

export interface DocumentReport {
  readonly kind: ValidatedKind;
  readonly path: string;
  readonly present: boolean;
  readonly schema_version: number | null;
  readonly problems: readonly Problem[];
  readonly unknown: readonly string[];
  readonly dropped: readonly Dropped[];
}

export interface ValidateReport {
  readonly ok: boolean;
  readonly dir: string;
  readonly documents: readonly DocumentReport[];
}

export interface ValidateManifestInput {
  readonly dir: string;
  readonly cliVersion: string;
  readonly providers: ProviderCatalog;
  readonly strict: boolean;
  readonly kind?: ValidatedKind | undefined;
}

const ORDER: readonly ValidatedKind[] = [
  'workspace',
  'environments',
  'tools',
  'members',
  'harness',
];

export class ValidateManifest {
  constructor(
    private readonly fs: FileReader,
    private readonly bundledTools: () => string,
  ) {}

  async execute(input: ValidateManifestInput): Promise<ValidateReport> {
    const opts: InspectLoadOptions = {
      cliVersion: input.cliVersion,
      providers: input.providers,
      strict: input.strict,
      allowInvalid: true,
    };
    const read = (kind: ValidatedKind): Promise<string | undefined> =>
      this.fs.readText(path.join(input.dir, MANIFEST_FILES[kind]));

    const workspaceText = await read('workspace');
    const workspace: Attempt<Workspace> =
      workspaceText === undefined
        ? {
            result: undefined,
            failure: { path: '(root)', message: 'Required manifest/workspace.yaml is missing.' },
          }
        : attempt(() => loadWorkspace(workspaceText, opts));
    const context = {
      workspace: workspace.result?.valid === true ? workspace.result.doc : undefined,
    };

    const loaders: Record<ValidatedKind, (text: string | undefined) => Attempt<unknown>> = {
      workspace: () => workspace,
      environments: (text) =>
        text === undefined ? absent() : attempt(() => loadEnvironments(text, opts, context)),
      tools: (text) => attempt(() => loadTools(this.bundledTools(), text, opts)),
      harness: (text) => (text === undefined ? absent() : attempt(() => loadHarness(text, opts))),
      members: (text) => (text === undefined ? absent() : attempt(() => loadMembers(text, opts))),
    };

    const documents: DocumentReport[] = [];
    for (const kind of ORDER.filter((k) => input.kind === undefined || k === input.kind)) {
      const text = kind === 'workspace' ? workspaceText : await read(kind);
      const outcome = loaders[kind](text);
      documents.push(report(kind, text !== undefined || kind === 'tools', outcome));
    }
    return {
      ok: documents.every((d) => d.problems.length === 0),
      dir: input.dir,
      documents,
    };
  }
}

interface Attempt<T> {
  readonly result: InspectedLoadResult<T> | undefined;
  readonly failure: Problem | undefined;
}

function attempt<T>(load: () => InspectedLoadResult<T>): Attempt<T> {
  try {
    return { result: load(), failure: undefined };
  } catch (err) {
    return { result: undefined, failure: { path: '(root)', message: asDevkitError(err).message } };
  }
}

function absent(): Attempt<never> {
  return { result: undefined, failure: undefined };
}

function report(kind: ValidatedKind, present: boolean, outcome: Attempt<unknown>): DocumentReport {
  const { result, failure } = outcome;
  return {
    kind,
    path: MANIFEST_FILES[kind],
    present,
    schema_version: result?.negotiation.schema ?? null,
    problems: failure === undefined ? (result?.problems ?? []) : [failure],
    unknown: result?.unknown ?? [],
    dropped: result?.dropped ?? [],
  };
}

export type { Workspace };
