// Edits one MCP entry while preserving surrounding JSON and JSONC bytes.

import { createHash } from 'node:crypto';

import {
  applyEdits,
  findNodeAtLocation,
  modify,
  parseTree,
  type Node,
  type ParseError,
} from 'jsonc-parser';

import type { McpResource } from '../../domain/manifest/types.js';
import type { McpCodec, McpProjectionInput, McpProjectionResult } from '../../ports/mcp-codec.js';

import { mcpLaunch } from './mcp-launch.js';

export class JsonMcpCodec implements McpCodec {
  constructor(private readonly platform = process.platform) {}
  project(input: McpProjectionInput): McpProjectionResult {
    const refused = (status: McpProjectionResult['status']): McpProjectionResult => ({
      status,
      text: input.current,
      digest: null,
    });
    const text = input.current ?? '{}\n';
    const root = readTree(text, input.support.protocol === 'json');
    if (!root) return refused('foreign');
    const servers = findNodeAtLocation(root, [input.support.rootKey]);
    if (servers && servers.type !== 'object') return refused('foreign');
    const current = findNodeAtLocation(root, [input.support.rootKey, input.name]);
    if (current && !input.owned) return refused('foreign');
    if (input.owned && (!current || digest(text, current) !== input.owned))
      return refused('conflict');
    if (!current && !input.resource)
      return { status: 'managed', text: input.current, digest: null };
    const value = input.resource ? nativeResource(input.resource, this.platform) : undefined;
    const edits = modify(text, [input.support.rootKey, input.name], value, {});
    const output = applyEdits(text, edits);
    const updated = readTree(output, input.support.protocol === 'json');
    if (!updated) return refused('foreign');
    const entry = findNodeAtLocation(updated, [input.support.rootKey, input.name]);
    return { status: 'managed', text: output, digest: entry ? digest(output, entry) : null };
  }
}

function readTree(text: string, strict: boolean): Node | undefined {
  const errors: ParseError[] = [];
  const root = parseTree(text, errors, { disallowComments: strict, allowTrailingComma: false });
  if (errors.length || root?.type !== 'object' || hasDuplicates(root)) return undefined;
  return root;
}
function hasDuplicates(node: Node): boolean {
  if (node.type === 'object') {
    const names = node.children?.map((property) => property.children?.[0]?.value as unknown) ?? [];
    if (new Set(names).size !== names.length) return true;
  }
  return node.children?.some(hasDuplicates) ?? false;
}
function digest(text: string, node: Node): string {
  return createHash('sha256')
    .update(text.slice(node.offset, node.offset + node.length))
    .digest('hex');
}
function nativeResource(resource: McpResource, platform: NodeJS.Platform): unknown {
  const refs = (values: McpResource['env']) =>
    Object.fromEntries(
      Object.entries(values ?? {}).map(([key, ref]) => [key, '${' + ref.from_env + '}']),
    );
  if (resource.transport === 'http')
    return { type: 'http', url: resource.url, headers: refs(resource.headers) };
  const vector = mcpLaunch(resource.command!, platform);
  return {
    command: vector[0],
    args: vector.slice(1),
    env: refs(resource.env),
  };
}
