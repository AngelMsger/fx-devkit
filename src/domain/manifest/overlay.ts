// The team's tools.yaml is a patch over the bundled baseline: tools match by name,
// objects merge recursively, scalars override, keyed lists merge by their key, unkeyed
// lists are replaced. Null deletes fields unless the schema accepts it as a value.
// Provenance records each field's origin for `tool show`.

import type * as z from 'zod';

import { isRaw, type PathPart, type Raw } from './document.js';
import { acceptsNullAt } from './reflect.js';
import type { Tool, Toolchain } from './types.js';

export type Origin = 'base' | 'patch';
export type Provenance = Readonly<Record<string, Readonly<Record<string, Origin>>>>;
export type MergePath = readonly (string | number)[];

export interface MergeOptions {
  // Non-nullable patch fields explicitly marked for deletion.
  readonly deletions?: readonly MergePath[];
}

export interface Merged {
  readonly toolchain: Toolchain;
  readonly provenance: Provenance;
}

export const DEFAULTS_KEY = '(defaults)';

type Plain = Record<string, unknown>;

const LIST_KEYS: Record<string, (item: Plain) => string> = {
  setup: (item) => String(item['id']),
  install: (item) => `${String(item['via'])}:${String(item['spec'] ?? '')}`,
};

export function mergeTools(
  base: Toolchain,
  patch: Toolchain | undefined,
  options: MergeOptions = {},
): Merged {
  const provenance: Record<string, Record<string, Origin>> = {};
  const record = (tool: string, field: string, origin: Origin): void => {
    provenance[tool] = { ...provenance[tool], [field]: origin };
  };
  const defaults = mergeValue(
    base.defaults,
    patch?.defaults,
    (field, origin) => record(DEFAULTS_KEY, field, origin),
    '',
  );
  const patched = new Map((patch?.tools ?? []).map((t) => [t.name, t]));
  const tools: Tool[] = base.tools.map((tool) => {
    const overlay = patched.get(tool.name);
    patched.delete(tool.name);
    const merged = mergeValue(
      tool,
      overlay,
      (field, origin) => record(tool.name, field, origin),
      '',
    ) as Tool;
    // The name identifies the entry; a tool the baseline knows stays a baseline tool.
    record(tool.name, 'name', 'base');
    return merged;
  });
  for (const tool of patched.values()) {
    tools.push(
      mergeValue(undefined, tool, (field, origin) => record(tool.name, field, origin), '') as Tool,
    );
  }

  const merged: Toolchain = {
    ...base,
    ...(patch?.min_cli === undefined ? {} : { min_cli: patch.min_cli }),
    ...(defaults === undefined ? {} : { defaults: defaults as Toolchain['defaults'] }),
    tools,
  };
  return { toolchain: applyDeletions(merged, options.deletions ?? [], patch), provenance };
}

function mergeValue(
  base: unknown,
  patch: unknown,
  record: (field: string, origin: Origin) => void,
  path: string,
): unknown {
  if (patch === undefined) {
    markBase(base, path, record);
    return base;
  }
  if (isPlain(base) && isPlain(patch)) {
    const out: Plain = {};
    for (const key of new Set([...Object.keys(base), ...Object.keys(patch)])) {
      const merged = mergeValue(base[key], patch[key], record, join(path, key));
      if (merged !== undefined) out[key] = merged;
    }
    return out;
  }
  if (Array.isArray(base) && Array.isArray(patch)) {
    const keyOf = LIST_KEYS[lastSegment(path)];
    if (keyOf !== undefined) {
      record(path, 'patch');
      return mergeKeyedList(base as Plain[], patch as Plain[], keyOf);
    }
  }
  if (isPlain(patch) && base === undefined) {
    for (const key of Object.keys(patch)) record(join(path, key), 'patch');
    return patch;
  }
  if (path !== '') record(path, 'patch');
  return patch;
}

function markBase(
  value: unknown,
  path: string,
  record: (field: string, origin: Origin) => void,
): void {
  if (value === undefined) return;
  if (isPlain(value)) {
    for (const [key, child] of Object.entries(value)) markBase(child, join(path, key), record);
    return;
  }
  if (path !== '') record(path, 'base');
}

function mergeKeyedList(base: Plain[], patch: Plain[], keyOf: (item: Plain) => string): Plain[] {
  const out = base.map((item) => ({ ...item }));
  for (const item of patch) {
    const index = out.findIndex((existing) => keyOf(existing) === keyOf(item));
    if (index === -1) out.push(item);
    else out[index] = mergeValue(out[index], item, () => undefined, '') as Plain;
  }
  return out;
}

function applyDeletions(
  toolchain: Toolchain,
  deletions: readonly MergePath[],
  patch: Toolchain | undefined,
): Toolchain {
  let result: unknown = toolchain;
  for (const deletion of deletions) {
    const path = resolveDeletion(deletion, patch, result as Toolchain);
    if (path !== undefined) result = removeAt(result, path);
  }
  return result as Toolchain;
}

function resolveDeletion(
  deletion: MergePath,
  patch: Toolchain | undefined,
  merged: Toolchain,
): MergePath | undefined {
  if (deletion[0] !== 'tools') return deletion;
  const patchIndex = deletion[1];
  if (typeof patchIndex !== 'number') return deletion;
  const name = patch?.tools[patchIndex]?.name;
  const mergedIndex =
    name === undefined ? -1 : merged.tools.findIndex((tool) => tool.name === name);
  return mergedIndex === -1 ? undefined : ['tools', mergedIndex, ...deletion.slice(2)];
}

function removeAt(value: unknown, path: MergePath): unknown {
  const [head, ...tail] = path;
  if (head === undefined) return undefined;
  if (Array.isArray(value) && typeof head === 'number') {
    const out = [...value];
    if (tail.length === 0) out.splice(head, 1);
    else out[head] = removeAt(out[head], tail);
    return out;
  }
  if (!isPlain(value) || typeof head !== 'string') return value;
  const out: Plain = { ...value };
  if (tail.length === 0) delete out[head];
  else {
    const child = removeAt(out[head], tail);
    if (child === undefined) delete out[head];
    else out[head] = child;
  }
  return out;
}

function isPlain(value: unknown): value is Plain {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function join(path: string, key: string): string {
  return path === '' ? key : `${path}.${key}`;
}

function lastSegment(path: string): string {
  return path.slice(path.lastIndexOf('.') + 1);
}

// Preserve schema-defined null values; other patch nulls delete fields after merging.
export function splitNulls(schema: z.ZodType, raw: Raw): { value: Raw; deletions: MergePath[] } {
  const deletions: MergePath[] = [];
  const visit = (node: unknown, path: PathPart[]): unknown => {
    if (Array.isArray(node)) return node.map((item, i) => visit(item, [...path, i]));
    if (!isRaw(node)) return node;
    const out: Raw = {};
    for (const [key, child] of Object.entries(node)) {
      if (child === null && !acceptsNullAt(schema, [...path, key])) deletions.push([...path, key]);
      else out[key] = visit(child, [...path, key]);
    }
    return out;
  };
  return { value: visit(raw, []) as Raw, deletions };
}
