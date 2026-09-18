// One decoding pipeline for every manifest document: negotiate its schema
// version, report or strip unknown fields, validate it, and quarantine the
// collection entries this fx release cannot use. A document whose remaining
// problems are not an entry's own fault is invalid and raises.

import type * as z from 'zod';

import { DevkitError } from '../errors.js';

import { formatPath, isRaw, parseManifest, type LineOf, type Raw } from './document.js';
import { remapIndexes, validateDocument, type EntrySpec, type Validated } from './issues.js';
import type { ProviderCatalog } from './providers.js';
import { partitionProblems } from './quarantine.js';
import { stripUnknown } from './reflect.js';
import type {
  Dropped,
  InspectedLoadResult,
  Kind,
  LoadResult,
  Negotiation,
  Problem,
} from './types.js';
import { negotiate, negotiationError } from './versioning.js';

export interface LoadOptions {
  readonly cliVersion: string;
  readonly strict?: boolean;
  // The providers this fx ships, for the rules that check a provider's own service
  // settings. Undefined means this load path has no catalog; see `serviceRules`.
  readonly providers?: ProviderCatalog;
}

export interface InspectLoadOptions extends LoadOptions {
  readonly allowInvalid: true;
}

export type AnyLoadOptions = LoadOptions | InspectLoadOptions;

export interface Spec<T> {
  readonly kind: Kind;
  readonly schema: z.ZodType<T, unknown>;
  readonly supported?: readonly number[];
  readonly entries?: EntrySpec;
  readonly rules: (doc: T) => Problem[];
  readonly invalidCode: (problems: readonly Problem[]) => string;
}

const NONE: Negotiation = { schema: undefined, minCli: undefined, failure: undefined };

export function load<T>(text: string, opts: AnyLoadOptions, spec: Spec<T>): InspectedLoadResult<T> {
  const { raw, lineOf } = parse(spec, text);
  return finish(spec, raw, opts, lineOf);
}

export function parse<T>(spec: Spec<T>, text: string): { raw: Raw; lineOf: LineOf } {
  const parsed = parseManifest(text);
  if ('problems' in parsed) throw invalid(spec, parsed.problems);
  return parsed;
}

export function finish<T>(
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
  problems.push(...unknownProblems(unknown, opts).map(withLine));

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
  const validated = validateDocument(spec.schema, spec.entries, value);
  problems.push(...validated.problems.map(withLine));
  const parsed = validated.doc;
  if (parsed !== undefined) {
    problems.push(
      ...spec.rules(parsed).map((p) => withLine(remapIndexes(p, spec.entries, validated.kept))),
    );
  }

  if (allowInvalid) {
    return parsed === undefined
      ? { valid: false, doc: null, problems, dropped: [], unknown, negotiation }
      : { valid: true, doc: parsed, problems, dropped: [], unknown, negotiation };
  }
  return finishValid({ spec, value, validated, parsed, problems, unknown, negotiation });
}

function unknownProblems(unknown: readonly string[], opts: AnyLoadOptions): Problem[] {
  // Unknown fields inside service blocks must never be silently stripped:
  // a shared manifest containing a credential must fail even outside strict mode.
  const problems = unknown
    .filter((path) => /(?:^|\.)service\./.test(path))
    .map((path) => ({
      path,
      message:
        'only public service settings are allowed; personal credentials stay on each member’s machine',
    }));
  if (opts.strict)
    problems.push(...unknown.map((path) => ({ path, message: 'unrecognised field' })));
  return problems;
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
      `No entry in the ${spec.kind} manifest could be used: ${dropped.map((d) => d.name).join(', ')}`,
      {
        hint: 'Every entry was rejected; the manifest and this fx release disagree about the entry format.',
        nextSteps: ['fx manifest validate', 'fx --version'],
      },
    );
  }
  return { valid: true, doc, problems, dropped, unknown, negotiation };
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
