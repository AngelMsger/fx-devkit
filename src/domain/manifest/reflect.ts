// Isolate Zod schema introspection for field descriptions, normalization and overlays.

import type * as z from 'zod';

export interface FieldInfo {
  readonly type: string;
  readonly required: boolean;
  readonly description: string | undefined;
  readonly children: readonly string[];
}

type AnySchema = z.ZodType;

// The slice of zod's definition record this file reads; `type` names the node kind.
interface Def {
  readonly type: string;
  readonly innerType?: AnySchema;
  readonly in?: AnySchema;
  readonly shape?: Record<string, AnySchema>;
  readonly element?: AnySchema;
  readonly valueType?: AnySchema;
  readonly options?: readonly AnySchema[];
  readonly values?: readonly unknown[];
  readonly entries?: Record<string, string | number>;
}

const defOf = (schema: AnySchema): Def => schema.def as Def;

export function kindOf(schema: AnySchema): string {
  return defOf(schema).type;
}

interface Unwrapped {
  readonly schema: AnySchema;
  readonly optional: boolean;
  readonly description: string | undefined;
}

export function unwrap(schema: AnySchema): Unwrapped {
  let current = schema;
  let optional = false;
  let description = schema.description;
  for (;;) {
    const def = defOf(current);
    if (OPTIONAL_WRAPPERS.has(def.type)) optional = true;
    // A pipe is read from its input side: that is what the author writes.
    const inner = def.innerType ?? def.in;
    if (inner === undefined) break;
    current = inner;
    description ??= current.description;
  }
  return { schema: current, optional, description };
}

const OPTIONAL_WRAPPERS = new Set(['optional', 'nullable', 'default', 'prefault']);

export function shapeOf(schema: AnySchema): Record<string, AnySchema> | undefined {
  const { schema: inner } = unwrap(schema);
  return kindOf(inner) === 'object' ? defOf(inner).shape : undefined;
}

export function elementOf(schema: AnySchema): AnySchema | undefined {
  const { schema: inner } = unwrap(schema);
  const def = defOf(inner);
  if (def.type === 'array') return def.element;
  if (def.type === 'record') return def.valueType;
  return undefined;
}

export function optionsOf(schema: AnySchema): readonly AnySchema[] | undefined {
  const { schema: inner } = unwrap(schema);
  const def = defOf(inner);
  return def.type === 'union' ? def.options : undefined;
}

export function describeType(schema: AnySchema): string {
  const { schema: inner } = unwrap(schema);
  const def = defOf(inner);
  switch (def.type) {
    case 'string':
      return 'string';
    case 'number':
      return 'number';
    case 'boolean':
      return 'boolean';
    case 'literal':
      return `literal ${(def.values ?? []).map((v) => JSON.stringify(v)).join(' | ')}`;
    case 'enum':
      return `one of ${Object.values(def.entries ?? {}).join(', ')}`;
    case 'array':
      return `array of ${describeType(elementOf(inner) as AnySchema)}`;
    case 'record':
      return `map of ${describeType(elementOf(inner) as AnySchema)}`;
    case 'object':
      return 'object';
    case 'union':
      return (optionsOf(inner) ?? []).map(describeType).join(' | ');
    default:
      return 'any';
  }
}

export function fieldInfo(schema: AnySchema): FieldInfo {
  const { optional, description } = unwrap(schema);
  const shape = shapeOf(schema);
  return {
    type: describeType(schema),
    required: !optional,
    description,
    children: shape === undefined ? [] : Object.keys(shape),
  };
}

// Every field reachable from the root that has no description, as paths.
// Union members, array elements and record values are descended into.
export function undescribedFields(schema: AnySchema, prefix = ''): string[] {
  const missing: string[] = [];
  const visit = (node: AnySchema, path: string): void => {
    if (unwrap(node).description === undefined) missing.push(path === '' ? '(root)' : path);
    const shape = shapeOf(node);
    if (shape !== undefined) {
      for (const [key, child] of Object.entries(shape))
        visit(child, path === '' ? key : `${path}.${key}`);
      return;
    }
    const element = elementOf(node);
    if (element !== undefined && kindOf(unwrap(element).schema) === 'object') {
      const suffix = kindOf(unwrap(node).schema) === 'array' ? '[]' : '.<key>';
      for (const [key, child] of Object.entries(shapeOf(element) ?? {}))
        visit(child, `${path}${suffix}.${key}`);
    }
    for (const option of optionsOf(node) ?? []) {
      for (const [key, child] of Object.entries(shapeOf(option) ?? {}))
        visit(child, `${path}.${key}`);
    }
  };
  visit(schema, prefix);
  return missing;
}

export interface Stripped {
  readonly value: unknown;
  readonly unknown: readonly (readonly (string | number)[])[];
}

// Removes the keys the schema does not know, reporting where they were.
// Runtime tolerates them (an older fx must keep working after the manifest
// grows); strict mode turns the report into errors.
export function stripUnknown(schema: AnySchema, value: unknown): Stripped {
  const unknown: (string | number)[][] = [];
  const visit = (
    nodes: readonly AnySchema[],
    current: unknown,
    path: (string | number)[],
  ): unknown => {
    const alternatives = nodes.flatMap(structuralAlternatives);
    if (alternatives.some((node) => ['any', 'unknown'].includes(kindOf(unwrap(node).schema))))
      return current;
    if (Array.isArray(current)) {
      const elements = alternatives.flatMap((node) => childrenOfKind(node, 'array'));
      return elements.length === 0
        ? current
        : current.map((item, i) => visit(elements, item, [...path, i]));
    }
    if (!isPlainObject(current)) return current;
    const shapes = alternatives.flatMap((node) => {
      const shape = shapeOf(node);
      return shape === undefined ? [] : [shape];
    });
    const records = alternatives.flatMap((node) => childrenOfKind(node, 'record'));
    if (shapes.length === 0 && records.length === 0) return current;
    const out: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(current)) {
      const fields = [
        ...records,
        ...shapes.flatMap((shape) => (Object.hasOwn(shape, key) ? [shape[key]!] : [])),
      ];
      if (fields.length === 0) unknown.push([...path, key]);
      else out[key] = visit(fields, child, [...path, key]);
    }
    return out;
  };
  return { value: visit([schema], value, []), unknown };
}

// Keep all declared alternatives intact; validation, not normalization, rejects mixed union branches.
function structuralAlternatives(schema: AnySchema): readonly AnySchema[] {
  const options = optionsOf(schema);
  return options === undefined ? [schema] : options.flatMap(structuralAlternatives);
}

function childrenOfKind(schema: AnySchema, kind: 'array' | 'record'): readonly AnySchema[] {
  if (kindOf(unwrap(schema).schema) !== kind) return [];
  const element = elementOf(schema);
  return element === undefined ? [] : [element];
}

// Overlay nulls are values only where the declared schema accepts them; other nulls remain deletions.
export function acceptsNullAt(schema: AnySchema, path: readonly (string | number)[]): boolean {
  let nodes: readonly AnySchema[] = [schema];
  for (const part of path) {
    nodes = nodes.flatMap(structuralAlternatives).flatMap((node) => {
      if (typeof part === 'number') return childrenOfKind(node, 'array');
      const shape = shapeOf(node);
      if (shape !== undefined && Object.hasOwn(shape, part)) return [shape[part]!];
      return childrenOfKind(node, 'record');
    });
    if (nodes.length === 0) return false;
  }
  return nodes.some((node) => node.safeParse(null).success);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
