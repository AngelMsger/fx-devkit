// `manifest explain`: a field's type, requiredness, description and children, read from
// the same schema that validates the document. A path may be spelled the way a problem
// prints it (repos[3].branch), the way docs write it (repos[].branch) or plainly
// (repos.branch).

import type * as z from 'zod';

import { DevkitError } from '../errors.js';
import { nearest, suggestionHint } from '../fuzzy.js';

import { environmentsSchema } from './environments.schema.js';
import { harnessSchema } from './harness.schema.js';
import { localSchema } from './local.schema.js';
import { membersSchema } from './members.schema.js';
import { elementOf, fieldInfo, kindOf, optionsOf, shapeOf, unwrap } from './reflect.js';
import { toolsSchema } from './tools.schema.js';
import type { Kind } from './types.js';
import { workspaceSchema } from './workspace.schema.js';

export interface FieldDoc {
  readonly path: string;
  readonly type: string;
  readonly required: boolean;
  readonly description: string;
  readonly children: readonly string[];
}

type Schema = z.ZodType;

export const SCHEMAS: Record<Kind, Schema> = {
  workspace: workspaceSchema,
  harness: harnessSchema,
  environments: environmentsSchema,
  tools: toolsSchema,
  members: membersSchema,
  local: localSchema,
};

export function describePath(kind: Kind, path: string | undefined): FieldDoc {
  const root = SCHEMAS[kind];
  const segments = (path ?? '')
    .replace(/\[\d*\]/g, '')
    .split('.')
    .filter((s) => s.length > 0);
  let node: Schema = root;
  const walked: string[] = [];
  for (const segment of segments) {
    const next = descend(node, segment);
    if (next === undefined) throw unknownField(kind, walked, segment, node);
    walked.push(canonical(node, segment));
    node = next;
  }
  const info = fieldInfo(node);
  return {
    path: walked.length === 0 ? '(root)' : joinPath(walked),
    type: info.type,
    required: walked.length === 0 ? true : info.required,
    description: info.description ?? '',
    children: childNames(node),
  };
}

// Steps into arrays, maps and object-shaped union members on the way to a
// named child, so `repos.branch` finds the field of one repository.
function descend(node: Schema, segment: string): Schema | undefined {
  const child = shapeOf(node)?.[segment];
  if (child !== undefined) return child;
  const element = elementOf(node);
  if (element !== undefined) return descend(element, segment);
  for (const option of optionsOf(node) ?? []) {
    const found = descend(option, segment);
    if (found !== undefined) return found;
  }
  return undefined;
}

function canonical(node: Schema, segment: string): string {
  if (shapeOf(node)?.[segment] !== undefined) return segment;
  const element = elementOf(node);
  if (element === undefined) return segment;
  return kindOf(unwrap(node).schema) === 'array'
    ? `[].${canonical(element, segment)}`
    : `<key>.${canonical(element, segment)}`;
}

function joinPath(segments: readonly string[]): string {
  return segments.join('.').replaceAll('.[]', '[]');
}

function childNames(node: Schema): string[] {
  const shape = shapeOf(node);
  if (shape !== undefined) return Object.keys(shape);
  const element = elementOf(node);
  if (element !== undefined) return childNames(element);
  return (optionsOf(node) ?? []).flatMap(childNames);
}

function unknownField(kind: Kind, walked: string[], segment: string, node: Schema): DevkitError {
  const attempted = joinPath([...walked, canonical(node, segment)]);
  const candidates = childNames(node);
  const suggestion = nearest(segment, candidates);
  const suggested =
    suggestion === undefined ? undefined : joinPath([...walked, canonical(node, suggestion)]);
  const hint = suggestionHint(
    suggested,
    `Known fields here: ${candidates.join(', ') || '(none)'}.`,
  );
  return new DevkitError(
    'usage',
    'UNKNOWN_MANIFEST_FIELD',
    `${kind} manifest has no field "${attempted}"`,
    {
      hint,
      nextSteps: [
        suggested === undefined
          ? `fx manifest explain --kind ${kind}`
          : `fx manifest explain --kind ${kind} ${suggested}`,
        `fx manifest schema --kind ${kind}`,
      ],
    },
  );
}
