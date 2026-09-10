// Which workspace a command means, from the registry alone: the name given,
// else the registered root that contains cwd, else the default. No file is
// read here, so a workspace whose manifest is broken can still be named.

import path from 'node:path';

import { DevkitError } from '../../domain/errors.js';
import { nearest } from '../../domain/fuzzy.js';
import { isAtOrInside } from '../../domain/path.js';
import type { DiagnosticReporter } from '../../ports/diagnostics.js';
import type { FileSystem } from '../../ports/fs.js';
import type { Reporter } from '../../ports/reporter.js';
import type { ConfigStore, WorkspaceEntry } from '../../ports/stores.js';

export interface Located {
  readonly name: string;
  readonly root: string;
  readonly manifestDir: string;
}

export interface ResolveInput {
  readonly cwd: string;
  readonly name?: string | undefined;
  readonly config: ConfigStore;
  readonly fs: FileSystem;
  readonly reporter: Reporter;
  readonly diagnostics?: DiagnosticReporter | undefined;
  readonly manifestDirFor: (name: string) => string;
}

export async function resolveWorkspace(input: ResolveInput): Promise<Located> {
  const config = await input.config.read();
  const registry = config.workspaces ?? {};
  const names = Object.keys(registry).sort();
  // The root as git and links will see it, so a registered alias resolves once.
  const locate = async (name: string, entry: WorkspaceEntry): Promise<Located> => ({
    name,
    root: await input.fs.realpath(path.resolve(entry.root)),
    manifestDir: input.manifestDirFor(name),
  });
  if (input.name !== undefined) {
    const entry = registry[input.name];
    if (entry === undefined) throw unknownWorkspace(input.name, names);
    return await locate(input.name, entry);
  }
  // Nested roots are legal; the innermost one owns cwd, judged on real paths.
  const candidates = await Promise.all(names.map((name) => locate(name, registry[name]!)));
  const cwd = await input.fs.realpath(path.resolve(input.cwd));
  for (const candidate of candidates.sort((a, b) => b.root.length - a.root.length))
    if (isAtOrInside(cwd, candidate.root)) return candidate;
  const fallback = config.default_workspace;
  const entry = fallback === undefined ? undefined : registry[fallback];
  if (fallback === undefined || entry === undefined) throw workspaceNotFound(input.cwd);
  if (names.length > 1) {
    input.reporter.notice({
      code: 'WORKSPACE_IMPLICIT',
      message: `outside any workspace; using default_workspace "${fallback}" (registered: ${names.join(', ')})`,
      nextSteps: [`fx --workspace <name> ...`],
      silence: `FX_WORKSPACE=${fallback}`,
      data: { active: fallback, available: names, override: '--workspace <name>' },
    });
  }
  return await locate(fallback, entry);
}

export function workspaceNotFound(cwd: string): DevkitError {
  return new DevkitError(
    'not_found',
    'WORKSPACE_NOT_FOUND',
    `${cwd} is not inside a registered workspace`,
    {
      hint: 'Run inside a workspace, name one with --workspace, or create one first.',
      nextSteps: ['fx init <dir> --from <manifest repository>'],
    },
  );
}

function unknownWorkspace(name: string, names: readonly string[]): DevkitError {
  const suggestion = nearest(name, names);
  return new DevkitError(
    'not_found',
    'WORKSPACE_UNKNOWN',
    `no workspace named "${name}" is registered`,
    {
      hint:
        suggestion === undefined
          ? `Registered: ${names.join(', ') || '(none)'}.`
          : `Did you mean "${suggestion}"?`,
      nextSteps: ['fx config get default_workspace', 'fx init <dir> --from <source>'],
    },
  );
}
