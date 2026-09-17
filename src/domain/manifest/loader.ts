// Decode manifest documents, negotiate versions and quarantine invalid entries.

import { LineCounter, parseDocument } from 'yaml';
import type * as z from 'zod';

import { DevkitError } from '../errors.js';

import { environmentsSchema } from './environments.schema.js';
import { harnessSchema, mcpSchema } from './harness.schema.js';
import { localSchema } from './local.schema.js';
import { membersSchema } from './members.schema.js';
import { mergeTools, type MergePath, type Provenance } from './overlay.js';
import { partitionProblems } from './quarantine.js';
import { stripUnknown } from './reflect.js';
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
  Dropped,
  Environments,
  Harness,
  InspectedLoadResult,
  Kind,
  LoadResult,
  LocalLayer,
  Members,
  Negotiation,
  Problem,
  Toolchain,
  Workspace,
} from './types.js';
import { negotiate, negotiationError, SUPPORTED } from './versioning.js';
import { repoSchema, workspaceSchema } from './workspace.schema.js';

export interface LoadOptions {
  readonly cliVersion: string;
  readonly strict?: boolean;
}

export interface InspectLoadOptions extends LoadOptions {
  readonly allowInvalid: true;
}

type AnyLoadOptions = LoadOptions | InspectLoadOptions;

export type ToolsLoadResult = LoadResult<Toolchain> & { readonly provenance: Provenance };
export type InspectedToolsLoadResult = InspectedLoadResult<Toolchain> & {
  readonly provenance: Provenance;
};

interface Spec<T> {
  readonly kind: Kind;
  readonly schema: z.ZodType<T, unknown>;
  readonly supported?: readonly number[];
  readonly entries?: {
    readonly key: 'repos' | 'tools' | 'mcp';
    readonly allowEmpty?: boolean;
    readonly schema: z.ZodType;
  };
  readonly rules: (doc: T) => Problem[];
  readonly invalidCode: (problems: readonly Problem[]) => string;
}

type PathPart = string | number;
type Raw = Record<string, unknown>;
type LineOf = (path: string) => number | undefined;
const NO_LINES: LineOf = () => undefined;

const NONE: Negotiation = { schema: undefined, minCli: undefined, failure: undefined };
// Issues carry the offending input only on request; "required" is told apart by it.
const REPORT_INPUT = { reportInput: true } as const;

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
    rules: workspaceRules,
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
      ...environmentsRules(doc),
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
  if (!base.valid) return { ...base, provenance: {} };
  if (patchText === undefined) {
    return { ...base, provenance: mergeTools(base.doc, undefined).provenance };
  }
  const { raw, lineOf } = parse(TOOLS, patchText);
  const { value, deletions } = splitNulls(raw);
  const patch = finish({ ...TOOLS, rules: () => [] }, value, opts, lineOf);
  if (!patch.valid) return { ...patch, provenance: mergeTools(base.doc, undefined).provenance };
  const merged = mergeTools(base.doc, patch.doc, { deletions });
  const result = finish(TOOLS, merged.toolchain as unknown as Raw, opts, NO_LINES);
  const retainedDrops = base.dropped.filter(
    (entry) => !result.doc?.tools.some((tool) => tool.name === entry.name),
  );
  const retainedProblems = base.problems.filter((problem) =>
    retainedDrops.some((entry) => entry.reason.includes(`${problem.path}: ${problem.message}`)),
  );
  return {
    ...result,
    problems: [...retainedProblems, ...patch.problems, ...result.problems],
    dropped: [...retainedDrops, ...result.dropped],
    unknown: [...base.unknown, ...patch.unknown],
    provenance: merged.provenance,
  };
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

function load<T>(text: string, opts: AnyLoadOptions, spec: Spec<T>): InspectedLoadResult<T> {
  const { raw, lineOf } = parse(spec, text);
  return finish(spec, raw, opts, lineOf);
}

function parse<T>(spec: Spec<T>, text: string): { raw: Raw; lineOf: LineOf } {
  const lines = new LineCounter();
  const doc = parseDocument(text, { lineCounter: lines });
  const syntax: Problem[] = doc.errors.map((e) => ({
    path: '(root)',
    message: e.message.split('\n')[0] ?? e.message,
    ...(e.linePos === undefined ? {} : { line: e.linePos[0].line }),
  }));
  const raw = doc.toJS() as unknown;
  if (syntax.length > 0) throw invalid(spec, syntax);
  if (!isRaw(raw)) throw invalid(spec, [{ path: '(root)', message: 'document must be a mapping' }]);
  const lineOf: LineOf = (path) => {
    const node = doc.getIn(toParts(path), true) as { range?: [number, number, number] } | undefined;
    return node?.range === undefined ? undefined : lines.linePos(node.range[0]).line;
  };
  return { raw, lineOf };
}

function finish<T>(
  spec: Spec<T>,
  raw: Raw,
  opts: AnyLoadOptions,
  lineOf: LineOf,
): InspectedLoadResult<T> {
  const allowInvalid = 'allowInvalid' in opts && opts.allowInvalid;
  const withLine = (p: Problem): Problem => {
    const line = lineOf(p.path);
    return line === undefined ? p : { ...p, line };
  };

  const problems: Problem[] = [];
  const negotiation =
    spec.supported === undefined ? NONE : negotiate(raw, opts.cliVersion, spec.supported);
  const mismatch = negotiationError(spec.kind, negotiation, opts.cliVersion);
  if (mismatch !== undefined) {
    if (!allowInvalid) throw mismatch;
    problems.push(withLine({ path: 'schema_version', message: mismatch.message }));
  }

  const stripped = stripUnknown(spec.schema, raw);
  const unknown = stripped.unknown.map(formatPath);
  // Unknown fields inside service blocks must never be silently stripped:
  // a shared manifest containing a credential must fail even outside strict mode.
  problems.push(
    ...unknown
      .filter((path) => /(?:^|\.)service\./.test(path))
      .map((path) =>
        withLine({
          path,
          message:
            'only public service settings are allowed; personal credentials stay on each member’s machine',
        }),
      ),
  );
  if (opts.strict)
    problems.push(...unknown.map((path) => withLine({ path, message: 'unrecognised field' })));

  const value = stripped.value as Raw;
  const collection = spec.entries === undefined ? undefined : value[spec.entries.key];
  if (
    spec.entries !== undefined &&
    Array.isArray(collection) &&
    collection.length === 0 &&
    !spec.entries.allowEmpty
  ) {
    problems.push(withLine({ path: spec.entries.key, message: 'must list at least one entry' }));
  }
  const validated = validate(spec, value);
  problems.push(...validated.problems.map(withLine));
  const parsed = validated.doc;
  if (parsed !== undefined) {
    problems.push(
      ...spec.rules(parsed).map((p) => withLine(remapIndexes(p, spec, validated.kept))),
    );
  }

  if (allowInvalid) {
    return parsed === undefined
      ? { valid: false, doc: null, problems, dropped: [], unknown, negotiation }
      : { valid: true, doc: parsed, problems, dropped: [], unknown, negotiation };
  }
  return finishValid({ spec, value, validated, parsed, problems, unknown, negotiation });
}

interface FinishValidInput<T> {
  readonly spec: Spec<T>;
  readonly value: Raw;
  readonly validated: Validated<T>;
  readonly parsed: T | undefined;
  readonly problems: readonly Problem[];
  readonly unknown: readonly string[];
  readonly negotiation: Negotiation;
}

function finishValid<T>(input: FinishValidInput<T>): LoadResult<T> {
  const { spec, value, validated, problems, unknown, negotiation } = input;
  if (spec.entries === undefined || input.parsed === undefined) {
    if (problems.length > 0) throw invalid(spec, problems);
    return {
      valid: true,
      doc: input.parsed as T,
      problems,
      dropped: [],
      unknown,
      negotiation,
    };
  }
  const { entries, document } = partitionProblems(problems, spec.entries.key);
  const dropped: Dropped[] = [...entries.entries()].map(([index, list]) => ({
    collection: spec.entries!.key,
    name: entryName(value, spec.entries!.key, index),
    reason: list.map((p) => `${p.path}: ${p.message}`).join('; '),
  }));
  if (document.length > 0) throw invalid(spec, problems);
  const survivors = (input.parsed as Raw)[spec.entries.key] as unknown[];
  const remaining = survivors.filter((_, i) => !entries.has(validated.kept[i] ?? i));
  const doc = { ...(input.parsed as Raw), [spec.entries.key]: remaining } as T;
  if (remaining.length === 0 && dropped.length > 0) {
    throw new DevkitError(
      'config',
      'MANIFEST_UNUSABLE',
      `no entry in the ${spec.kind} manifest could be used: ${dropped.map((d) => d.name).join(', ')}`,
      {
        hint: 'Every entry was rejected; the manifest and this fx release disagree about the entry format.',
        nextSteps: ['fx manifest validate', 'fx --version'],
      },
    );
  }
  return { valid: true, doc, problems, dropped, unknown, negotiation };
}

interface Validated<T> {
  readonly doc: T | undefined;
  readonly problems: Problem[];
  readonly kept: readonly number[];
}

// Entries are validated one by one under their original index so a problem
// names the line the reader sees; the document is then validated with only
// the entries that passed, and `kept` maps its indexes back.
function validate<T>(spec: Spec<T>, value: Raw): Validated<T> {
  const problems: Problem[] = [];
  const kept: number[] = [];
  let candidate: Raw = value;
  const entries = spec.entries;
  if (entries !== undefined && Array.isArray(value[entries.key])) {
    const good: unknown[] = [];
    (value[entries.key] as unknown[]).forEach((entry, i) => {
      const result = entries.schema.safeParse(entry, REPORT_INPUT);
      if (result.success) {
        good.push(entry);
        kept.push(i);
      } else {
        problems.push(...issuesToProblems(result.error.issues, [entries.key, i]));
      }
    });
    candidate = { ...value, [entries.key]: good };
  }
  const result = spec.schema.safeParse(candidate, REPORT_INPUT);
  if (result.success) return { doc: result.data, problems, kept };
  problems.push(...issuesToProblems(result.error.issues, []));
  return { doc: undefined, problems, kept };
}

function remapIndexes<T>(problem: Problem, spec: Spec<T>, kept: readonly number[]): Problem {
  if (spec.entries === undefined) return problem;
  const pattern = new RegExp(`^${spec.entries.key}\\[(\\d+)\\]`);
  const path = problem.path.replace(
    pattern,
    (_, i: string) => `${spec.entries!.key}[${kept[Number(i)] ?? i}]`,
  );
  return { ...problem, path };
}

function issuesToProblems(issues: readonly z.ZodIssue[], prefix: readonly PathPart[]): Problem[] {
  // A YAML document has no symbol keys; zod's path type merely allows them.
  const parts = (issue: z.ZodIssue): PathPart[] =>
    issue.path.filter((part): part is PathPart => typeof part !== 'symbol');
  return issues.map((issue) => ({
    path: formatPath([...prefix, ...parts(issue)]),
    message:
      issue.code === 'invalid_type' && issue.input === undefined ? 'required' : issue.message,
  }));
}

// A null in a patch means "delete this field". Schemas do not accept null,
// so nulls are lifted out before validation and applied after the merge.
function splitNulls(raw: Raw): { value: Raw; deletions: MergePath[] } {
  const deletions: MergePath[] = [];
  const visit = (node: unknown, path: PathPart[]): unknown => {
    if (Array.isArray(node)) return node.map((item, i) => visit(item, [...path, i]));
    if (!isRaw(node)) return node;
    const out: Raw = {};
    for (const [key, child] of Object.entries(node)) {
      if (child === null) deletions.push([...path, key]);
      else out[key] = visit(child, [...path, key]);
    }
    return out;
  };
  return { value: visit(raw, []) as Raw, deletions };
}

function entryName(value: Raw, key: string, index: number): string {
  const entry = (value[key] as unknown[])[index];
  const name = isRaw(entry) ? entry['name'] : undefined;
  return typeof name === 'string' && name.length > 0 ? name : `${key}[${index}]`;
}

function invalid<T>(spec: Spec<T>, problems: readonly Problem[]): DevkitError {
  const shown = problems
    .slice(0, 5)
    .map((p) => `${p.line === undefined ? '' : `line ${p.line}: `}${p.path}: ${p.message}`);
  const more = problems.length > 5 ? ` (and ${problems.length - 5} more)` : '';
  return new DevkitError(
    'config',
    spec.invalidCode(problems),
    `${spec.kind} manifest is invalid: ${shown.join('; ')}${more}`,
    {
      hint: 'Fix the listed paths; `fx manifest explain <path>` describes a field.',
      nextSteps: [
        'fx manifest validate',
        `fx manifest explain --kind ${spec.kind} ${problems[0]?.path ?? ''}`.trim(),
      ],
      diagnostics: [
        {
          kind: 'manifest',
          phase: `${spec.kind} manifest validation`,
          field: problems[0]?.path ?? '(root)',
          ...(problems[0]?.line === undefined ? {} : { line: problems[0].line }),
        },
      ],
    },
  );
}

export function formatPath(parts: readonly PathPart[]): string {
  return parts.reduce<string>((acc, part) => {
    if (typeof part === 'number') return `${acc}[${part}]`;
    return acc === '' ? part : `${acc}.${part}`;
  }, '');
}

export function toParts(path: string): PathPart[] {
  const parts: PathPart[] = [];
  for (const segment of path.split('.')) {
    const match = /^([^[]*)((?:\[\d+\])*)$/.exec(segment);
    if (match === null || match[1] === undefined) continue;
    if (match[1] !== '') parts.push(match[1]);
    for (const index of match[2]?.match(/\d+/g) ?? []) parts.push(Number(index));
  }
  return parts;
}

function isRaw(value: unknown): value is Raw {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
