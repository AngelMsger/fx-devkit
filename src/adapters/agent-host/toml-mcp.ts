// Edits receipt-owned TOML fragments without reserializing foreign content.

import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';

import { parse, stringify } from 'smol-toml';

import { assessMcpSupport } from '../../domain/harness/mcp.js';
import type { McpResource } from '../../domain/manifest/types.js';
import type { McpCodec, McpProjectionInput, McpProjectionResult } from '../../ports/mcp-codec.js';

import { mcpLaunch } from './mcp-launch.js';

export class TomlMcpCodec implements McpCodec {
  constructor(private readonly platform = process.platform) {}
  project(input: McpProjectionInput): McpProjectionResult {
    const refused = (status: McpProjectionResult['status']): McpProjectionResult => ({
      status,
      text: input.current,
      digest: null,
    });
    if (input.resource && !assessMcpSupport(input.support, input.resource).supported)
      return refused('unsupported');
    const text = input.current ?? '';
    const doc = readToml(text);
    if (!doc) return refused('foreign');
    const markers = { start: `# fx:mcp:${input.name}:start`, end: `# fx:mcp:${input.name}:end` };
    const fragment = findFragment(text, markers);
    const entries = doc[input.support.rootKey];
    if (entries !== undefined && !isRecord(entries)) return refused('foreign');
    const exists = isRecord(entries) && Object.hasOwn(entries, input.name);
    if ((exists || fragment) && !input.owned) return refused('foreign');
    if (input.owned && (!exists || !fragment || hash(fragment.text) !== input.owned))
      return refused('conflict');
    if (!exists && !input.resource) return { status: 'managed', text: input.current, digest: null };
    if (fragment && !matchesFragment(fragment.text, input, entries)) return refused('conflict');
    const before = fragment ? text.slice(0, fragment.start) : text;
    const after = fragment ? text.slice(fragment.end) : '';
    const base = readToml(before + after);
    const baseEntries = base?.[input.support.rootKey];
    if (!base || (isRecord(baseEntries) && Object.hasOwn(baseEntries, input.name)))
      return refused('foreign');
    const eol = text.includes('\r\n') ? '\r\n' : '\n';
    const block = input.resource
      ? `${markers.start}${eol}${stringify({ [input.support.rootKey]: { [input.name]: nativeResource(input.resource, this.platform) } }).replace(/\n/g, eol)}${markers.end}${eol}`
      : '';
    const prefix = !fragment && before && !before.endsWith('\n') ? eol : '';
    const output = before + prefix + block + after;
    if (!readToml(output)) return refused('foreign');
    return { status: 'managed', text: output, digest: block ? hash(block) : null };
  }
}

function readToml(text: string): Record<string, unknown> | undefined {
  try {
    return parse(text, { integersAsBigInt: 'asNeeded' });
  } catch {
    return undefined;
  }
}
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function findFragment(
  text: string,
  markers: { start: string; end: string },
): { start: number; end: number; text: string } | undefined {
  const start = text.indexOf(markers.start);
  if (start < 0 || (start > 0 && text[start - 1] !== '\n')) return undefined;
  const closing = text.indexOf(markers.end, start);
  if (
    closing < 0 ||
    text[closing - 1] !== '\n' ||
    text.indexOf(markers.start, start + 1) >= 0 ||
    text.indexOf(markers.end, closing + 1) >= 0
  )
    return undefined;
  const lineEnd = text.indexOf('\n', closing);
  const end = lineEnd < 0 ? text.length : lineEnd + 1;
  return { start, end, text: text.slice(start, end) };
}
function hash(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}
function nativeResource(resource: McpResource, platform: NodeJS.Platform): Record<string, unknown> {
  if (resource.transport === 'http')
    return {
      url: resource.url,
      env_http_headers: Object.fromEntries(
        Object.entries(resource.headers ?? {}).map(([key, ref]) => [key, ref.from_env]),
      ),
    };
  const vector = mcpLaunch(resource.command!, platform);
  return {
    command: vector[0],
    args: vector.slice(1),
    env_vars: Object.values(resource.env ?? {}).map((ref) => ref.from_env),
  };
}

function matchesFragment(text: string, input: McpProjectionInput, entries: unknown): boolean {
  const parsed = readToml(text)?.[input.support.rootKey];
  return (
    isRecord(parsed) &&
    isRecord(entries) &&
    isDeepStrictEqual(parsed[input.name], entries[input.name])
  );
}
