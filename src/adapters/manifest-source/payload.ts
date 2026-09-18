// The distributable source payload shared by directory and stdin imports.
// Git metadata and local tool configuration are not workspace content.

import path from 'node:path';

import { DevkitError } from '../../domain/errors.js';
import { MANIFEST_FILES } from '../../domain/manifest/files.js';
import type { FileSystem } from '../../ports/fs.js';
import type { ReplaceFiles } from '../../ports/replace-files.js';

export const PAYLOAD_PATHS = [
  ...Object.values(MANIFEST_FILES),
  'AGENTS.md',
  'CLAUDE.md',
  'README.md',
  'docs',
  'skills',
];

export function assertPayloadPath(name: string): void {
  const parts = name.split('/');
  if (
    name.includes('\\') ||
    name.includes('\0') ||
    parts.some((part) => part === '' || part === '.' || part === '..') ||
    !PAYLOAD_PATHS.some(
      (root) =>
        name === root || ((root === 'docs' || root === 'skills') && name.startsWith(`${root}/`)),
    )
  )
    throw new DevkitError(
      'config',
      'MANIFEST_SOURCE_INVALID',
      `Invalid source payload path: ${name}`,
      {
        nextSteps: [
          `Name the payload entry ${PAYLOAD_PATHS.join(', ')} or a path under docs/ or skills/, without backslash, "." or ".." segments.`,
        ],
      },
    );
}

export async function preparePayload(
  fs: FileSystem,
  dir: string,
  changed: readonly string[],
  replace?: ReplaceFiles,
): Promise<void> {
  const existing: string[] = [];
  for (const name of changed) {
    const target = path.join(dir, name);
    if ((await fs.exists(target)) || (await fs.readLink(target)) !== undefined)
      existing.push(target);
  }
  if (existing.length === 0) return;
  if (replace !== undefined && (await replace(existing))) return;
  throw new DevkitError(
    'conflict',
    'MANIFEST_REPLACE_REQUIRED',
    'Existing source files were left unchanged',
    {
      hint: `Confirm replacement of: ${existing.join(', ')}`,
      nextSteps: ['Run init interactively to review and back up the existing files.'],
    },
  );
}
