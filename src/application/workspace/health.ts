// Readiness diagnostics preserve the registered identity and exact recovery target.

import path from 'node:path';

import { asDevkitError, DevkitError, toEnvelope, type ErrorEnvelope } from '../../domain/errors.js';
import { MANIFEST_FILES } from '../../domain/manifest/files.js';
import { shellLine } from '../../domain/shell.js';
import { LoadManifest } from '../manifest/load.js';

import type { Located, ResolveInput } from './resolve.js';

export type WorkspaceHealth = 'ready' | 'root_missing' | 'unprepared' | 'missing' | 'invalid';
export interface HealthInput extends Pick<ResolveInput, 'fs' | 'config' | 'commandShell'> {
  readonly bundledTools: () => string;
  readonly cliVersion: string;
}
export interface WorkspaceHealthResult {
  readonly status: WorkspaceHealth;
  readonly error: ErrorEnvelope['error'] | null;
}

export async function workspaceReadiness(
  input: HealthInput,
  located: Located,
): Promise<WorkspaceHealthResult> {
  try {
    await assertWorkspacePrepared(input, located);
    await new LoadManifest(input.fs, input.bundledTools).execute({
      dir: located.manifestDir,
      cliVersion: input.cliVersion,
    });
    return { status: 'ready', error: null };
  } catch (error) {
    const failure = contextualWorkspaceError(input, located, error);
    const statuses: Readonly<Record<string, WorkspaceHealth>> = {
      WORKSPACE_ROOT_MISSING: 'root_missing',
      MANIFEST_UNPREPARED: 'unprepared',
      MANIFEST_MISSING: 'missing',
    };
    const status = statuses[failure.code] ?? 'invalid';
    return { status, error: toEnvelope(failure).error };
  }
}

export async function assertWorkspacePrepared(
  input: Pick<HealthInput, 'fs' | 'config' | 'commandShell'>,
  located: Located,
  allowMissingRoot = false,
): Promise<void> {
  await assertNoWorkspaceOperation(input, located);
  const command = (...args: string[]) => shellLine(['fx', ...args], input.commandShell);
  if (!allowMissingRoot && !(await input.fs.isDirectory(located.root)))
    throw new DevkitError(
      'not_found',
      'WORKSPACE_ROOT_MISSING',
      `Workspace "${located.name}" root is missing: ${located.root}`,
      {
        hint: 'Restore the directory, or point this registration at its moved directory. Repository synchronization will not recreate a missing workspace root.',
        nextSteps: [
          command('workspace', 'show', located.name),
          command('workspace', 'relocate', located.name, '<existing-directory>'),
        ],
      },
    );
  if (await input.fs.exists(path.join(located.manifestDir, MANIFEST_FILES.workspace))) return;
  const prepared = await input.fs.isDirectory(located.manifestDir);
  const source = (await input.config.read()).workspaces?.[located.name]?.source;
  throw new DevkitError(
    'config',
    prepared ? 'MANIFEST_MISSING' : 'MANIFEST_UNPREPARED',
    `Workspace "${located.name}" ${prepared ? 'is missing manifest/workspace.yaml' : 'manifest has not been prepared'}.`,
    {
      hint: 'Recover the manifest from the registered source; existing business checkouts and personal selections are preserved.',
      nextSteps: [
        command('init', located.root, '--name', located.name, '--from', source ?? '<source>'),
        command('workspace', 'show', located.name),
      ],
    },
  );
}

export function contextualWorkspaceError(
  input: Pick<HealthInput, 'commandShell'>,
  located: Located,
  error: unknown,
): DevkitError {
  const failure = asDevkitError(error);
  if (
    !failure.code.startsWith('MANIFEST_') ||
    ['MANIFEST_MISSING', 'MANIFEST_UNPREPARED'].includes(failure.code)
  )
    return failure;
  return new DevkitError(failure.category, failure.code, failure.message, {
    hint: failure.hint,
    cause: failure,
    diagnostics: failure.diagnostics,
    nextSteps: [
      shellLine(['fx', 'manifest', 'validate', '--workspace', located.name], input.commandShell),
      shellLine(['fx', 'workspace', 'show', located.name], input.commandShell),
    ],
  });
}

export async function assertNoWorkspaceOperation(
  input: Pick<HealthInput, 'fs' | 'commandShell'>,
  located: Pick<Located, 'name' | 'manifestDir'>,
): Promise<void> {
  const file = path.join(path.dirname(located.manifestDir), 'workspace-operation.json');
  if (!(await input.fs.exists(file))) return;
  throw new DevkitError(
    'conflict',
    'WORKSPACE_OPERATION_PENDING',
    `Workspace "${located.name}" has an unfinished identity operation.`,
    {
      hint: `Inspect ${file}; retry the original workspace unregister, relocate or rebind command before other workspace operations.`,
      nextSteps: [shellLine(['fx', 'workspace', 'show', located.name], input.commandShell)],
    },
  );
}
