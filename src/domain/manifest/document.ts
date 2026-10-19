// Turn manifest text into a plain object and keep every path's source line, so a
// problem can name the line its reader sees. Syntax errors are returned, not
// thrown: which code a malformed document reports is the decoder's decision.

import { LineCounter, parseDocument } from 'yaml';

import { isRecord } from '../values.js';

import type { Problem } from './types.js';

export type PathPart = string | number;
export type Raw = Record<string, unknown>;
export type LineOf = (path: string) => number | undefined;

export const NO_LINES: LineOf = () => undefined;

export interface ParsedManifest {
  readonly raw: Raw;
  readonly lineOf: LineOf;
}

export function parseManifest(
  text: string,
): ParsedManifest | { readonly problems: readonly Problem[] } {
  const lines = new LineCounter();
  const doc = parseDocument(text, { lineCounter: lines });
  const syntax: Problem[] = doc.errors.map((e) => ({
    path: '(root)',
    message: e.message.split('\n')[0] ?? e.message,
    ...(e.linePos === undefined ? {} : { line: e.linePos[0].line }),
  }));
  const raw = doc.toJS() as unknown;
  if (syntax.length > 0) return { problems: syntax };
  if (!isRecord(raw))
    return { problems: [{ path: '(root)', message: 'document must be a mapping' }] };
  const lineOf: LineOf = (path) => {
    const node = doc.getIn(toParts(path), true) as { range?: [number, number, number] } | undefined;
    return node?.range === undefined ? undefined : lines.linePos(node.range[0]).line;
  };
  return { raw, lineOf };
}

export function formatPath(parts: readonly PathPart[]): string {
  return parts.reduce<string>((acc, part) => {
    if (typeof part === 'number') return `${acc}[${part}]`;
    return acc === '' ? part : `${acc}.${part}`;
  }, '');
}

function toParts(path: string): PathPart[] {
  const parts: PathPart[] = [];
  for (const segment of path.split('.')) {
    const match = /^([^[]*)((?:\[\d+\])*)$/.exec(segment);
    if (match === null || match[1] === undefined) continue;
    if (match[1] !== '') parts.push(match[1]);
    for (const index of match[2]?.match(/\d+/g) ?? []) parts.push(Number(index));
  }
  return parts;
}
