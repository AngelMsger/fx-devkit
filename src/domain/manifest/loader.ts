// The manifest documents this release can read: each names its schema, its
// supported versions, the collection whose entries may be quarantined and the
// rules it is checked against. Decoding itself belongs to `decode`.

import {
  finish,
  load,
  parse,
  type AnyLoadOptions,
  type InspectLoadOptions,
  type LoadOptions,
  type Spec,
} from './decode.js';
import { NO_LINES, type Raw } from './document.js';
import { environmentsSchema } from './environments.schema.js';
import { harnessSchema, mcpSchema } from './harness.schema.js';
import { localSchema } from './local.schema.js';
import { membersSchema } from './members.schema.js';
import { mergeTools, splitNulls, type Provenance } from './overlay.js';
import { droppedEntryOf } from './quarantine.js';
import {
  environmentsRules,
  obsReferenceRules,
  releaseReferenceRules,
} from './rules/environments.js';
import { harnessRules } from './rules/harness.js';
import { membersRules } from './rules/members.js';
import { toolsRules } from './rules/tools.js';
import { workspaceRules } from './rules/workspace.js';
import { toolSchema, toolsSchema } from './tools.schema.js';
import type {
  Environments,
  Harness,
  InspectedLoadResult,
  LoadResult,
  LocalLayer,
  Members,
  Toolchain,
  Workspace,
} from './types.js';
import { SUPPORTED } from './versioning.js';
import { repoSchema, workspaceSchema } from './workspace.schema.js';

export type { InspectLoadOptions, LoadOptions } from './decode.js';

export type ToolsLoadResult = LoadResult<Toolchain> & Selection;
export type InspectedToolsLoadResult = InspectedLoadResult<Toolchain> & Selection;

interface Selection {
  readonly provenance: Provenance;
  readonly declared: readonly string[];
}

export function loadWorkspace(
  text: string,
  opts: InspectLoadOptions,
): InspectedLoadResult<Workspace>;
export function loadWorkspace(text: string, opts: LoadOptions): LoadResult<Workspace>;
export function loadWorkspace(text: string, opts: AnyLoadOptions): InspectedLoadResult<Workspace> {
  return load(text, opts, {
    kind: 'workspace',
    schema: workspaceSchema,
    supported: SUPPORTED.workspace,
    entries: { key: 'repos', schema: repoSchema },
    rules: (doc) => workspaceRules(doc, opts.providers),
    invalidCode: () => 'MANIFEST_INVALID',
  });
}

export function loadEnvironments(
  text: string,
  opts: InspectLoadOptions,
  context?: { readonly workspace?: Workspace | undefined },
): InspectedLoadResult<Environments>;
export function loadEnvironments(
  text: string,
  opts: LoadOptions,
  context?: { readonly workspace?: Workspace | undefined },
): LoadResult<Environments>;
export function loadEnvironments(
  text: string,
  opts: AnyLoadOptions,
  context: { readonly workspace?: Workspace | undefined } = {},
): InspectedLoadResult<Environments> {
  return load(text, opts, {
    kind: 'environments',
    schema: environmentsSchema,
    supported: SUPPORTED.environments,
    rules: (doc) => [
      ...environmentsRules(doc, opts.providers),
      ...(context.workspace === undefined
        ? []
        : [
            ...obsReferenceRules(context.workspace, doc),
            ...releaseReferenceRules(context.workspace, doc),
          ]),
    ],
    invalidCode: () => 'MANIFEST_INVALID',
  });
}

const TOOLS: Spec<Toolchain> = {
  kind: 'tools',
  schema: toolsSchema,
  supported: SUPPORTED.tools,
  entries: { key: 'tools', schema: toolSchema },
  rules: toolsRules,
  invalidCode: () => 'MANIFEST_INVALID',
};

export function loadToolsDocument(
  text: string,
  opts: InspectLoadOptions,
): InspectedLoadResult<Toolchain>;
export function loadToolsDocument(text: string, opts: LoadOptions): LoadResult<Toolchain>;
export function loadToolsDocument(
  text: string,
  opts: AnyLoadOptions,
): InspectedLoadResult<Toolchain> {
  const { raw, lineOf } = parse(TOOLS, text);
  return finish(TOOLS, raw, opts, lineOf);
}

// A tools overlay has inherited requirements; lint its declared fields without standalone rules.
export function loadToolsPatchDocument(text: string, opts: LoadOptions): LoadResult<Toolchain>;
export function loadToolsPatchDocument(
  text: string,
  opts: AnyLoadOptions,
): InspectedLoadResult<Toolchain> {
  const { raw, lineOf } = parse(TOOLS, text);
  const { value } = splitNulls(TOOLS.schema, raw);
  return finish({ ...TOOLS, rules: () => [] }, value, opts, lineOf);
}

// The bundled baseline is loaded in full; the team patch is only checked
// against the schema (it is incomplete by nature); the merged result is
// then validated and quarantined like any document.
export function loadTools(
  bundledText: string,
  patchText: string | undefined,
  opts: InspectLoadOptions,
): InspectedToolsLoadResult;
export function loadTools(
  bundledText: string,
  patchText: string | undefined,
  opts: LoadOptions,
): ToolsLoadResult;
export function loadTools(
  bundledText: string,
  patchText: string | undefined,
  opts: AnyLoadOptions,
): InspectedToolsLoadResult {
  const base = load(bundledText, opts, TOOLS);
  if (!base.valid) return { ...base, provenance: {}, declared: [] };
  if (patchText === undefined) {
    // No patch still goes through the merge: it is what drops the opt-in tools nobody named.
    const merged = mergeTools(base.doc, undefined);
    return { ...base, doc: merged.toolchain, ...selection(merged) };
  }
  const { raw, lineOf } = parse(TOOLS, patchText);
  const { value, deletions } = splitNulls(TOOLS.schema, raw);
  const patch = finish({ ...TOOLS, rules: () => [] }, value, opts, lineOf);
  if (!patch.valid) return { ...patch, ...selection(mergeTools(base.doc, undefined)) };
  const merged = mergeTools(base.doc, patch.doc, { deletions });
  const result = finish(TOOLS, merged.toolchain as unknown as Raw, opts, NO_LINES);
  const retainedDrops = base.dropped.filter(
    (entry) => !result.doc?.tools.some((tool) => tool.name === entry.name),
  );
  const retainedProblems = base.problems.filter(
    (problem) => droppedEntryOf(problem, retainedDrops) !== undefined,
  );
  return {
    ...result,
    problems: [...retainedProblems, ...patch.problems, ...result.problems],
    dropped: [...retainedDrops, ...result.dropped],
    unknown: [...base.unknown, ...patch.unknown],
    ...selection(merged),
  };
}

function selection(merged: ReturnType<typeof mergeTools>): Selection {
  return { provenance: merged.provenance, declared: merged.declared };
}

export function loadHarness(text: string, opts: InspectLoadOptions): InspectedLoadResult<Harness>;
export function loadHarness(text: string, opts: LoadOptions): LoadResult<Harness>;
export function loadHarness(text: string, opts: AnyLoadOptions): InspectedLoadResult<Harness> {
  return load(text, opts, {
    kind: 'harness',
    schema: harnessSchema,
    supported: SUPPORTED.harness,
    entries: { key: 'mcp', schema: mcpSchema, allowEmpty: true },
    rules: harnessRules,
    invalidCode: () => 'MANIFEST_INVALID',
  });
}

export function loadMembers(text: string, opts: InspectLoadOptions): InspectedLoadResult<Members>;
export function loadMembers(text: string, opts: LoadOptions): LoadResult<Members>;
export function loadMembers(text: string, opts: AnyLoadOptions): InspectedLoadResult<Members> {
  return load(text, opts, {
    kind: 'members',
    schema: membersSchema,
    supported: SUPPORTED.members,
    rules: membersRules,
    invalidCode: (problems) =>
      problems.some((p) => p.path === 'sensitive') ? 'MEMBERS_NOT_SENSITIVE' : 'MANIFEST_INVALID',
  });
}

export function loadLocal(
  text: string,
  opts: { readonly allowInvalid: true },
): InspectedLoadResult<LocalLayer>;
export function loadLocal(
  text: string,
  opts?: { readonly allowInvalid?: false },
): LoadResult<LocalLayer>;
export function loadLocal(
  text: string,
  opts: { readonly allowInvalid?: boolean } = {},
): InspectedLoadResult<LocalLayer> {
  const loadOptions: AnyLoadOptions =
    opts.allowInvalid === true
      ? { cliVersion: '', strict: true, allowInvalid: true }
      : { cliVersion: '', strict: true };
  return load(text, loadOptions, {
    kind: 'local',
    schema: localSchema,
    rules: () => [],
    invalidCode: () => 'LOCAL_INVALID',
  });
}
