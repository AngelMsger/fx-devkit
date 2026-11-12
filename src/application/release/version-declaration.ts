// Select one written version source at an immutable commit. Explicit paths name
// packages; automatic discovery prefers VERSION and never skips an empty declaration.

import path from 'node:path';

import { DevkitError } from '../../domain/errors.js';
import {
  sameVersionSource,
  type VersionDeclaration,
  type VersionSource,
} from '../../domain/release/version-evidence.js';
import { VERSION_READERS, versionDeclaration } from '../../domain/release/version.js';
import type { CodeHostQueries, RepoRef } from '../../ports/code-host.js';

export interface DeclarationQuery {
  readonly host: CodeHostQueries;
  readonly ref: RepoRef;
  readonly sha: string;
  readonly path?: string;
  readonly source?: VersionSource;
}

export async function readVersionDeclaration(input: DeclarationQuery): Promise<VersionDeclaration> {
  const file = input.source?.file ?? input.path;
  if (file !== undefined) return readSelected(input, file);
  for (const candidate of Object.keys(VERSION_READERS)) {
    const text = await input.host.readFile(input.ref, candidate, input.sha);
    if (text !== undefined) return parseSelected(input, candidate, text);
  }
  throw versionFailure('VERSION_DECLARATION_MISSING', `No version declaration at ${input.sha}`);
}

async function readSelected(input: DeclarationQuery, file: string): Promise<VersionDeclaration> {
  validateVersionPath(file);
  const text = await input.host.readFile(input.ref, file, input.sha);
  if (text === undefined)
    throw versionFailure(
      'VERSION_PATH_MISSING',
      `${file} is absent at ${input.sha}; creation and rename are not distinguished`,
    );
  return parseSelected(input, file, text);
}

async function parseSelected(
  input: DeclarationQuery,
  file: string,
  text: string,
): Promise<VersionDeclaration> {
  const declaration = versionDeclaration(file, text);
  if (
    declaration === undefined &&
    input.source === undefined &&
    ['build.gradle', 'build.gradle.kts'].includes(path.posix.basename(file))
  )
    return readSelected(input, path.posix.join(path.posix.dirname(file), 'gradle.properties'));
  if (declaration === undefined)
    throw versionFailure(
      'VERSION_DECLARATION_UNREADABLE',
      `${file} has no readable version declaration at ${input.sha}`,
    );
  if (input.source !== undefined && !sameVersionSource(input.source, declaration))
    throw versionFailure(
      'VERSION_SOURCE_CHANGED',
      `Version field or package identity differs at ${input.sha}`,
    );
  return declaration;
}

export function validateVersionPath(file: string): void {
  if (
    file === '' ||
    file.includes('\\') ||
    file.startsWith('/') ||
    file.split('/').some((part) => part === '' || part === '.' || part === '..') ||
    !Object.hasOwn(VERSION_READERS, path.posix.basename(file))
  )
    throw new DevkitError('usage', 'VERSION_PATH_INVALID', `Unsupported version path: ${file}`, {
      nextSteps: ['Use a repository-relative path to VERSION or supported package metadata.'],
    });
}

export function versionFailure(code: string, message: string): DevkitError {
  return new DevkitError('incomplete', code, message, {
    nextSteps: [
      'Inspect the pinned repository ref and declaration source, then retry with sufficient readable history.',
    ],
  });
}
