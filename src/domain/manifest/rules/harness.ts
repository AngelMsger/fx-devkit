// Resource rules enforce transport exclusivity and scan authored literals.
// Findings name fields and constraints without repeating protected values.

import { scanBoundary } from '../../boundary/scan.js';
import { isPublicHttpUrl } from '../../public-url.js';
import type { Harness, McpResource, Problem } from '../types.js';

export function harnessRules(doc: Harness): Problem[] {
  const problems: Problem[] = [];
  const names = new Set<string>();
  for (const [index, resource] of doc.mcp.entries()) {
    const prefix = `mcp[${index}]`;
    if (names.has(resource.name))
      problems.push({ path: 'mcp', message: 'resource names must be unique' });
    names.add(resource.name);
    problems.push(
      ...resourceProblems(resource).map((p) => ({ ...p, path: `${prefix}.${p.path}` })),
    );
  }
  return problems;
}

function resourceProblems(resource: McpResource): Problem[] {
  const problems: Problem[] = [];
  const add = (path: string, message: string) => problems.push({ path, message });
  if (resource.transport === 'stdio') {
    if (!resource.command) add('command', 'stdio requires a startup vector');
    if (resource.url !== undefined || resource.headers !== undefined)
      add('transport', 'stdio cannot declare HTTP fields');
  } else {
    if (!resource.url || !isPublicHttpUrl(resource.url))
      add('url', 'HTTP requires an endpoint without credentials, query or fragment');
    if (resource.command !== undefined || resource.env !== undefined)
      add('transport', 'HTTP cannot declare stdio fields');
  }
  const references = Object.values({ ...resource.env, ...resource.headers }).map(
    (ref) => ref.from_env,
  );
  for (const name of references) {
    if (!resource.variables?.[name])
      add('variables', 'every referenced variable requires human setup instructions');
  }
  const literals = [
    resource.name,
    resource.description ?? '',
    ...(resource.command ?? []),
    resource.url ?? '',
    ...(resource.check?.command ?? []),
    JSON.stringify(resource.check?.json ?? null),
    ...Object.values(resource.variables ?? {}).map((v) => v.instructions),
  ];
  if (literals.some((text) => scanBoundary({ text, policy: 'manifest' }).length > 0))
    add('content', 'protected content is not allowed; use environment references');
  return problems;
}
