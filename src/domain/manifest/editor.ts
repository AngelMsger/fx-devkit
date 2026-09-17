// Byte-faithful editing of workspace.yaml. The document is parsed only to
// find byte ranges; the change is a splice of the original text, so
// comments, blank lines, indentation and quoting outside the edited value
// survive by construction rather than by a serializer's good will.

import {
  isMap,
  isScalar,
  isSeq,
  parseDocument,
  type Node,
  type Pair,
  type Range,
  type YAMLMap,
} from 'yaml';

import { DevkitError } from '../errors.js';
import { nearest } from '../fuzzy.js';

import { shapeOf } from './reflect.js';
import { repoSchema } from './workspace.schema.js';

export const SETTABLE_REPO_FIELDS = [
  'path',
  'desc',
  'branch',
  'project',
  'upstream',
  'aka',
] as const;
export type SettableRepoField = (typeof SETTABLE_REPO_FIELDS)[number];

export interface EditResult {
  readonly text: string;
  readonly before: string | null;
  readonly after: string;
  readonly action: 'replaced' | 'added';
}

export function setRepoField(text: string, repo: string, field: string, value: string): EditResult {
  const settable = assertSettable(field);
  const entry = findRepo(text, repo);
  const pair = entry.items.find((p) => isScalar(p.key) && p.key.value === settable);
  if (settable === 'aka') {
    const aliases = parseAliases(value);
    const rendered = JSON.stringify(aliases);
    const edited =
      pair === undefined
        ? add(text, entry, settable, rendered, rendered)
        : replaceAliases(text, pair, rendered);
    verify(edited.text, repo, settable, aliases);
    return edited;
  }
  const edited =
    pair === undefined ? add(text, entry, settable, value) : replace(text, pair, value);
  verify(edited.text, repo, settable, value);
  return edited;
}

function assertSettable(field: string): SettableRepoField {
  if ((SETTABLE_REPO_FIELDS as readonly string[]).includes(field))
    return field as SettableRepoField;
  const known = Object.keys(shapeOf(repoSchema) ?? {});
  if (known.includes(field)) {
    throw new DevkitError(
      'usage',
      'MANIFEST_SET_UNSUPPORTED',
      `"${field}" is not supported by manifest repo-set; edit it by hand`,
      {
        hint: `manifest repo-set changes a scalar or aka array: ${SETTABLE_REPO_FIELDS.join(', ')}.`,
        nextSteps: ['Edit manifest/workspace.yaml directly, then run fx manifest validate.'],
      },
    );
  }
  const suggestion = nearest(field, [...SETTABLE_REPO_FIELDS]);
  throw new DevkitError('usage', 'UNKNOWN_MANIFEST_FIELD', `a repository has no field "${field}"`, {
    hint:
      suggestion === undefined
        ? `Settable fields: ${SETTABLE_REPO_FIELDS.join(', ')}.`
        : `Did you mean "${suggestion}"?`,
    nextSteps: ['fx manifest explain repos[]'],
  });
}

function findRepo(text: string, repo: string): YAMLMap {
  const doc = parseDocument(text);
  const repos = doc.get('repos', true);
  const entries = isSeq(repos) ? repos.items.filter(isMap) : [];
  const names = entries.map((m) => String(m.get('name', true)?.toString() ?? ''));
  const index = names.indexOf(repo);
  const found = entries[index];
  if (found !== undefined) return found;
  const suggestion = nearest(repo, names);
  throw new DevkitError(
    'not_found',
    'REPO_NOT_FOUND',
    `no repository named "${repo}" in the manifest`,
    {
      hint:
        suggestion === undefined
          ? 'fx repo list shows the known names.'
          : `Did you mean "${suggestion}"?`,
      nextSteps: ['fx repo list'],
    },
  );
}

function replace(text: string, pair: Pair, value: string): EditResult {
  const node = pair.value;
  if (!isScalar(node) || !hasRange(node)) {
    throw new DevkitError(
      'usage',
      'MANIFEST_SET_UNSUPPORTED',
      'the field is not a scalar in this manifest; edit it by hand',
      {
        nextSteps: ['Edit manifest/workspace.yaml directly, then run fx manifest validate.'],
      },
    );
  }
  const [start, end] = node.range;
  const before = String(node.value);
  const rendered = renderLike(node.type, value);
  return {
    text: text.slice(0, start) + rendered + text.slice(end),
    before,
    after: value,
    action: 'replaced',
  };
}

function parseAliases(value: string): readonly string[] {
  const doc = parseDocument(value);
  let decoded: unknown;
  try {
    if (doc.errors.length === 0) decoded = doc.toJS();
  } catch {
    // Unresolved YAML anchors are invalid input, not an internal edit failure.
    decoded = undefined;
  }
  const parsed = repoSchema.shape.aka.safeParse(decoded);
  if (!parsed.success || parsed.data === undefined) {
    throw new DevkitError(
      'usage',
      'INVALID_MANIFEST_VALUE',
      'aka must be an array of non-blank strings',
      {
        hint: 'Pass a JSON or YAML string array, for example ["platform", "accounts"].',
        nextSteps: ['fx manifest explain repos[].aka'],
      },
    );
  }
  return parsed.data;
}

function replaceAliases(text: string, pair: Pair, rendered: string): EditResult {
  const node = pair.value;
  if (!isSeq(node) || !hasRange(node)) {
    throw new DevkitError(
      'usage',
      'MANIFEST_SET_UNSUPPORTED',
      'aka is not an array in this manifest; edit it by hand',
      {
        nextSteps: ['Edit manifest/workspace.yaml directly, then run fx manifest validate.'],
      },
    );
  }
  const [start, end] = node.range;
  const ending = text.slice(start, end).endsWith('\n') ? '\n' : '';
  return {
    text: text.slice(0, start) + rendered + ending + text.slice(end),
    before: JSON.stringify(node.toJSON()),
    after: rendered,
    action: 'replaced',
  };
}

function add(
  text: string,
  entry: YAMLMap,
  field: string,
  value: string,
  rendered = renderLike('PLAIN', value),
): EditResult {
  const firstKey = entry.items[0]?.key;
  if (entry.flow === true || !isScalar(firstKey) || !hasRange(firstKey) || !hasRange(entry)) {
    throw new DevkitError(
      'usage',
      'MANIFEST_SET_UNSUPPORTED',
      'cannot add a field to a flow-style entry; edit it by hand',
      {
        nextSteps: ['Edit manifest/workspace.yaml directly, then run fx manifest validate.'],
      },
    );
  }
  const indent = ' '.repeat(
    firstKey.range[0] - (text.lastIndexOf('\n', firstKey.range[0] - 1) + 1),
  );
  const at = entry.range[1];
  const needsNewline = at > 0 && text[at - 1] !== '\n';
  const line = `${needsNewline ? '\n' : ''}${indent}${field}: ${rendered}\n`;
  return {
    text: text.slice(0, at) + line + text.slice(at),
    before: null,
    after: value,
    action: 'added',
  };
}

function hasRange<T extends Node>(node: T): node is T & { range: Range } {
  return node.range !== null && node.range !== undefined;
}

function renderLike(style: string | undefined, value: string): string {
  if (style === 'QUOTE_DOUBLE') return JSON.stringify(value);
  if (style === 'QUOTE_SINGLE' || !isPlainSafe(value)) return `'${value.replaceAll("'", "''")}'`;
  return value;
}

// Plain scalars that YAML would read back as the same string.
function isPlainSafe(value: string): boolean {
  if (value === '' || /^\s|\s$/.test(value) || /[#\n]|: |^[-?:,[\]{}&*!|>'"%@`]/.test(value))
    return false;
  if (/^(?:true|false|yes|no|on|off|null|~)$/i.test(value)) return false;
  return (
    !/^[+-]?(?:\d[\d_]*(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(value) && !/^0x|^0o/i.test(value)
  );
}

function verify(
  text: string,
  repo: string,
  field: string,
  value: string | readonly string[],
): void {
  const doc = parseDocument(text);
  const node: unknown = doc.errors.length === 0 ? findRepo(text, repo).get(field, true) : undefined;
  let readBack: unknown;
  if (isScalar(node)) readBack = node.value;
  else if (isSeq(node)) readBack = node.toJSON();
  if (JSON.stringify(readBack) !== JSON.stringify(value)) {
    throw new DevkitError(
      'internal',
      'EDIT_PRODUCED_INVALID_YAML',
      `editing ${repo}.${field} did not read back as written; nothing was changed`,
      {
        nextSteps: ['Edit manifest/workspace.yaml by hand and report this.'],
      },
    );
  }
}
