// Discovery reads every registration without requiring any workspace to be healthy.

import path from 'node:path';

import { asDevkitError, toEnvelope, type ErrorEnvelope } from '../../domain/errors.js';
import { isAtOrInside } from '../../domain/path.js';

import { workspaceReadiness, type HealthInput, type WorkspaceHealthResult } from './health.js';
import { resolveWorkspace, type Located, type ResolveInput } from './resolve.js';

export interface WorkspaceRecord extends WorkspaceHealthResult {
  readonly name: string;
  readonly root: string;
  readonly source: string | null;
  readonly manifest: string;
  readonly default: boolean;
  readonly cwd_match: boolean;
  readonly selected: boolean;
  readonly selection: Located['selection'] | null;
}
export const WORKSPACE_COLUMNS = [
  'name',
  'root',
  'source',
  'default',
  'cwd_match',
  'selected',
  'selection',
  'registration_status',
] as const;

export interface WorkspaceDiscovery {
  readonly items: readonly WorkspaceRecord[];
  readonly has_more: false;
  readonly default_workspace: string | null;
  readonly selection_error: ErrorEnvelope['error'] | null;
}
export async function discoverWorkspaces(
  input: ResolveInput & HealthInput,
): Promise<WorkspaceDiscovery> {
  const config = await input.config.read();
  let selected: Located | undefined;
  let selectionError = null;
  try {
    selected = await resolveWorkspace(input);
  } catch (error) {
    selectionError = toEnvelope(asDevkitError(error)).error;
  }
  const cwd = await input.fs.realpath(path.resolve(input.cwd));
  const items: WorkspaceRecord[] = [];
  for (const [name, entry] of Object.entries(config.workspaces ?? {}).sort(([a], [b]) =>
    a.localeCompare(b),
  )) {
    const root = await input.fs.realpath(path.resolve(entry.root));
    const located: Located = {
      name,
      root,
      manifestDir: input.manifestDirFor(name),
      selection: selected?.selection ?? 'explicit',
    };
    items.push({
      name,
      root,
      source: entry.source ?? null,
      manifest: located.manifestDir,
      default: config.default_workspace === name,
      cwd_match: isAtOrInside(cwd, root),
      selected: selected?.name === name,
      selection: selected?.name === name ? selected.selection : null,
      ...(await workspaceReadiness(input, located)),
    });
  }
  return {
    items,
    has_more: false,
    default_workspace: config.default_workspace ?? null,
    selection_error: selectionError,
  };
}

export async function showWorkspace(input: ResolveInput & HealthInput): Promise<WorkspaceRecord> {
  const located = await resolveWorkspace(input);
  const result = await discoverWorkspaces({ ...input, name: located.name });
  const record = result.items.find((item) => item.name === located.name)!;
  return { ...record, selection: located.selection };
}
