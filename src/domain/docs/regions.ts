// Replace fx-owned regions while preserving author text. Source rendering reports
// missing regions; generated workspace guides may append them through completeRegions.

import { DevkitError } from '../errors.js';

export const begin = (name: string): string => `<!-- fx:begin ${name} -->`;
export const end = (name: string): string => `<!-- fx:end ${name} -->`;

export interface RenderedRegions {
  readonly text: string;
  readonly replaced: readonly string[];
  readonly missing: readonly string[];
  readonly unknown: readonly string[];
  readonly added?: readonly string[];
}

const MARKER = /<!-- fx:begin ([a-z0-9-]+) -->/g;
const BOUNDARY = /<!-- fx:(begin|end) ([a-z0-9-]+) -->/g;
const RETIRED = new Set(['rules']);

export function completeRegions(
  doc: string,
  regions: Readonly<Record<string, string>>,
): RenderedRegions {
  const seen = new Set<string>();
  let opening: string | undefined;
  for (const marker of doc.matchAll(BOUNDARY)) {
    const name = marker[2]!;
    if (marker[1] === 'begin') {
      if (opening !== undefined || seen.has(name)) throw invalidRegions(name);
      opening = name;
      seen.add(name);
    } else {
      if (opening !== name) throw invalidRegions(name);
      opening = undefined;
    }
  }
  if (opening !== undefined) throw invalidRegions(opening);
  const rendered = renderRegions(doc, regions);
  const added = rendered.missing;
  const suffix = added.map((name) => region(name, regions[name]!)).join('\n\n');
  return {
    ...rendered,
    text: suffix
      ? `${rendered.text}${rendered.text.endsWith('\n') ? '\n' : '\n\n'}${suffix}\n`
      : rendered.text,
    missing: [],
    added,
  };
}

function invalidRegions(name: string): DevkitError {
  return new DevkitError(
    'conflict',
    'DOCS_REGIONS_INVALID',
    `The guide has ambiguous fx markers near ${name}`,
    {
      hint: 'Nested, duplicate and unclosed regions are preserved rather than rewritten.',
      nextSteps: ['Repair the marker pairs in the source AGENTS.md, then retry initialization.'],
    },
  );
}

export function renderRegions(
  doc: string,
  regions: Readonly<Record<string, string>>,
): RenderedRegions {
  const present = [...doc.matchAll(MARKER)].map((m) => m[1] ?? '');
  const replaced: string[] = [];
  let text = removeRetired(doc);
  for (const [name, body] of Object.entries(regions)) {
    const from = text.indexOf(begin(name));
    const to = text.indexOf(end(name), from);
    if (from === -1 || to === -1) continue;
    text = `${text.slice(0, from + begin(name).length)}\n${body.trim()}\n${text.slice(to)}`;
    replaced.push(name);
  }
  return {
    text,
    replaced,
    missing: Object.keys(regions).filter((name) => !replaced.includes(name)),
    unknown: present.filter((name) => !(name in regions)),
  };
}

// Only an unambiguous top-level pair is removable. A nested or malformed
// block may contain human-owned markers, so leave that whole block alone.
function removeRetired(doc: string): string {
  const stack: RegExpExecArray[] = [];
  const spans: { readonly start: number; readonly end: number }[] = [];
  let nested = false;
  for (const marker of doc.matchAll(BOUNDARY)) {
    if (marker[1] === 'begin') {
      if (stack.length === 0) nested = false;
      else nested = true;
      stack.push(marker);
      continue;
    }
    const opening = stack.pop();
    if (opening === undefined || stack.length > 0 || nested) continue;
    if (opening[2] === marker[2] && RETIRED.has(opening[2] ?? ''))
      spans.push({ start: opening.index, end: marker.index + marker[0].length });
  }
  let text = doc;
  for (const span of spans.reverse()) text = text.slice(0, span.start) + text.slice(span.end);
  return text;
}

export function region(name: string, body: string): string {
  return `${begin(name)}\n${body.trim()}\n${end(name)}`;
}
