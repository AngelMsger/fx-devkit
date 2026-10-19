// Which workspace a command means, from the registry: the name or root given,
// else the registered root that contains cwd, else the default. No manifest
// is read here, so broken workspaces can still be selected.

import path from 'node:path';

import { DevkitError } from '../../domain/errors.js';
import { nearest, suggestionHint } from '../../domain/fuzzy.js';
import { isAtOrInside, samePath } from '../../domain/path.js';
import { shellLine, type ResolvedShell } from '../../domain/shell.js';
import type { DiagnosticReporter } from '../../ports/diagnostics.js';
import type { FileSystem } from '../../ports/fs.js';
import type { Reporter } from '../../ports/reporter.js';
import type { ConfigStore, WorkspaceEntry } from '../../ports/stores.js';

import { assertDefaultWorkspace } from './registry.js';

export interface Located {
  readonly name: string;
  readonly root: string;
  readonly manifestDir: string;
  readonly selection: 'explicit' | 'cwd' | 'default';
}

export interface ResolveInput {
  readonly cwd: string;
  readonly selection?: Located['selection'];
  readonly commandShell?: ResolvedShell | undefined;
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
  const locate = async (
    name: string,
    entry: WorkspaceEntry,
    selection: Located['selection'],
  ): Promise<Located> => ({
    selection,
    name,
    root: await input.fs.realpath(path.resolve(entry.root)),
    manifestDir: input.manifestDirFor(name),
  });
  if (input.name !== undefined) {
    const selected = await explicitWorkspace(
      input.name,
      input.cwd,
      registry,
      input.fs,
      input.commandShell,
    );
    return await locate(selected.name, selected.entry, input.selection ?? 'explicit');
  }
  // Nested roots are legal; the innermost one owns cwd, judged on real paths.
  const candidates = await Promise.all(names.map((name) => locate(name, registry[name]!, 'cwd')));
  const cwd = await input.fs.realpath(path.resolve(input.cwd));
  const matches = candidates
    .filter((candidate) => isAtOrInside(cwd, candidate.root))
    .sort((a, b) => b.root.length - a.root.length);
  const candidate = matches[0];
  if (candidate) {
    const aliases = matches.filter((item) => samePath(item.root, candidate.root));
    if (aliases.length > 1) throw ambiguousRoot(aliases.map((item) => item.name));
    return candidate;
  }
  assertDefaultWorkspace(config);
  const fallback = config.default_workspace;
  const entry = fallback === undefined ? undefined : registry[fallback];
  if (fallback === undefined || entry === undefined)
    throw workspaceNotFound(input.cwd, names, input.commandShell);
  if (names.length > 1) {
    input.reporter.notice({
      code: 'WORKSPACE_IMPLICIT',
      message: `outside any workspace; using default_workspace "${fallback}" (registered: ${names.join(', ')})`,
      nextSteps: [`fx --workspace <name> ...`],
      silence: `FX_WORKSPACE=${fallback}`,
      data: { active: fallback, available: names, override: '--workspace <name>' },
    });
  }
  return await locate(fallback, entry, 'default');
}

export async function explicitWorkspace(
  selector: string,
  cwd: string,
  registry: Readonly<Record<string, WorkspaceEntry>>,
  fs: FileSystem,
  shell?: ResolvedShell,
): Promise<{ name: string; entry: WorkspaceEntry }> {
  const named = registry[selector];
  if (Object.hasOwn(registry, selector) && named) return { name: selector, entry: named };
  const root = await fs.realpath(path.resolve(cwd, selector));
  const entries = await Promise.all(
    Object.entries(registry).map(async ([name, entry]) => ({
      name,
      entry,
      root: await fs.realpath(path.resolve(entry.root)),
    })),
  );
  const matches = entries.filter((entry) => samePath(root, entry.root));
  if (matches.length > 1) throw ambiguousRoot(matches.map((entry) => entry.name));
  if (!matches[0]) throw unknownWorkspace(selector, Object.keys(registry).sort(), shell);
  return { name: matches[0].name, entry: matches[0].entry };
}

function ambiguousRoot(names: readonly string[]): DevkitError {
  return new DevkitError(
    'conflict',
    'WORKSPACE_ROOT_AMBIGUOUS',
    `This directory has multiple workspace registrations: ${names.join(', ')}`,
    {
      hint: 'Choose a registration by name, then unregister the duplicate identity.',
      nextSteps: [
        'fx workspace list',
        'fx workspace show <name>',
        'fx workspace unregister <duplicate> --dry-run',
      ],
    },
  );
}

function workspaceNotFound(
  cwd: string,
  names: readonly string[] = [],
  shell?: ResolvedShell,
): DevkitError {
  return new DevkitError(
    'not_found',
    'WORKSPACE_NOT_FOUND',
    `${cwd} is not inside a registered workspace`,
    {
      hint: names.length
        ? `Registered: ${names.join(', ')}. Choose one with --workspace or set default_workspace.`
        : 'No workspaces are registered. Initialize one first.',
      nextSteps: names.length
        ? ['fx workspace list', shellLine(['fx', 'status', '--workspace', names[0]!], shell)]
        : ['fx init <dir> --from <manifest repository>'],
    },
  );
}

function unknownWorkspace(
  name: string,
  names: readonly string[],
  shell: ResolvedShell | undefined,
): DevkitError {
  const suggestion = nearest(name, names);
  return new DevkitError(
    'not_found',
    'WORKSPACE_UNKNOWN',
    `No registered workspace matches "${name}"`,
    {
      hint: suggestionHint(suggestion, `Registered: ${names.join(', ') || '(none)'}.`),
      nextSteps: [
        'fx workspace list',
        ...(names.length
          ? [shellLine(['fx', 'workspace', 'show', suggestion ?? names[0]!], shell)]
          : ['fx init <dir> --from <source>']),
      ],
    },
  );
}
