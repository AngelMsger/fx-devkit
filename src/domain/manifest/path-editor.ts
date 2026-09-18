// Selected YAML string fields are spliced by parser ranges. Ancestor anchors
// and aliases are refused because a local edit could otherwise change another scope.

import { isMap, isScalar, parseDocument, type Node, type YAMLMap } from 'yaml';

import { DevkitError } from '../errors.js';

interface StringEdit {
  readonly path: readonly string[];
  readonly value: string;
}
interface StringEdits {
  readonly text: string;
  readonly values: readonly StringEdit[];
}

export function setYamlStrings(input: StringEdits): string {
  let text = input.text;
  for (const edit of input.values) text = editOne(text, edit);
  const document = parseDocument(text);
  if (
    document.errors.length ||
    input.values.some((edit) => document.getIn([...edit.path]) !== edit.value)
  )
    throw unsupported();
  return text;
}

function editOne(text: string, edit: StringEdit): string {
  const document = parseDocument(text);
  if (document.errors.length || !edit.path.length) throw unsupported();
  let map = document.contents;
  for (let index = 0; index < edit.path.length; index++) {
    if (!isMap(map) || map.anchor) throw unsupported();
    const key = edit.path[index]!;
    const pair = map.items.find((item) => isScalar(item.key) && item.key.value === key);
    if (!pair) return insert(text, map, edit.path.slice(index), edit.value);
    const node = pair.value;
    if (index === edit.path.length - 1) {
      if (!isScalar(node) || node.anchor || !node.range) throw unsupported();
      if (node.value === edit.value) return text;
      const value =
        node.type === 'BLOCK_LITERAL' || node.type === 'BLOCK_FOLDED'
          ? blockValue(text, node, edit.value, indentation(text, pair.key))
          : JSON.stringify(edit.value);
      return text.slice(0, node.range[0]) + value + text.slice(node.range[1]);
    }
    if (!isMap(node)) throw unsupported();
    map = node;
  }
  throw unsupported();
}

function insert(text: string, map: YAMLMap, keys: readonly string[], value: string): string {
  if (!map.range) throw unsupported();
  if (map.flow) {
    const last = map.items.at(-1)?.value;
    const at = map.items.length ? rangeEnd(last) : map.range[0] + 1;
    let nested: unknown = value;
    for (const key of keys.slice(1).reverse()) nested = Object.fromEntries([[key, nested]]);
    const entry = `${map.items.length ? ', ' : ''}${JSON.stringify(keys[0])}: ${JSON.stringify(nested)}`;
    return text.slice(0, at) + entry + text.slice(at);
  }
  const indent = indentation(text, map.items[0]?.key);
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  const rendered =
    keys
      .map(
        (key, index) =>
          `${' '.repeat(indent + index * 2)}${JSON.stringify(key)}:${index === keys.length - 1 ? ' ' + JSON.stringify(value) : ''}`,
      )
      .join(eol) + eol;
  const at = map.range[1];
  return text.slice(0, at) + (at && text[at - 1] !== '\n' ? eol : '') + rendered + text.slice(at);
}

function blockValue(text: string, node: Node, value: string, indent: number): string {
  if (!node.range) throw unsupported();
  const raw = text.slice(node.range[0], node.range[1]);
  const eol = raw.includes('\r\n') ? '\r\n' : '\n';
  const header = raw.split(/\r?\n/)[0] ?? '|';
  let marker = '|-';
  if (value.endsWith('\n')) marker = '|';
  if (value.endsWith('\n\n')) marker = '|+';
  const comment = header.replace(/^[|>][+\-1-9]*/, '');
  const lines = value.split('\n');
  if (value.endsWith('\n')) lines.pop();
  return (
    marker + comment + eol + lines.map((line) => ' '.repeat(indent + 2) + line).join(eol) + eol
  );
}

function indentation(text: string, node: unknown): number {
  if (!isScalar(node) || !node.range) throw unsupported();
  return node.range[0] - text.lastIndexOf('\n', node.range[0] - 1) - 1;
}

function rangeEnd(node: unknown): number {
  if (
    typeof node === 'object' &&
    node !== null &&
    'range' in node &&
    Array.isArray(node.range) &&
    typeof node.range[1] === 'number'
  )
    return node.range[1];
  throw unsupported();
}

function unsupported(): DevkitError {
  return new DevkitError(
    'config',
    'MANIFEST_EDIT_UNSUPPORTED',
    'The selected YAML path cannot be edited without changing another scope',
    { nextSteps: ['Use an unambiguous, unanchored mapping for the target entry and retry.'] },
  );
}
