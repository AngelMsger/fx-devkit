// stdin accepts workspace.yaml or a portable source bundle. Bundles preserve
// accompanying docs, Skills and binary assets without borrowing local paths.

import { randomUUID } from 'node:crypto';
import path from 'node:path';

import YAML from 'yaml';

import { DevkitError } from '../../domain/errors.js';
import { MANIFEST_FILES } from '../../domain/manifest/files.js';
import type { FileSystem } from '../../ports/fs.js';
import type { ManifestSource, ManifestSourceInspection } from '../../ports/manifest-source.js';
import type { ReplaceFiles } from '../../ports/replace-files.js';

import { FileSource } from './file.js';
import { assertPayloadPath } from './payload.js';

// Bundle entries are named with forward slashes on every platform.
const WORKSPACE_ENTRY = MANIFEST_FILES.workspace.split(path.sep).join('/');

interface PayloadFile {
  readonly name: string;
  readonly bytes: Uint8Array;
  readonly executable: boolean;
}

export class StdinSource implements ManifestSource {
  readonly kind = 'stdin';
  readonly description = '-';

  constructor(
    private readonly text: string,
    private readonly fs: FileSystem,
    private readonly replace?: ReplaceFiles,
  ) {}

  async inspect(): Promise<ManifestSourceInspection> {
    const files = this.files();
    return {
      root: 'stdin',
      readText: async (name) => {
        const file = files.find((item) => item.name === name);
        return file === undefined ? undefined : Buffer.from(file.bytes).toString('utf8');
      },
    };
  }

  async materialize(dir: string): Promise<void> {
    const files = this.files();
    const scratch = `${dir}.import-${randomUUID()}`;
    try {
      for (const file of files)
        await this.fs.writeBytes(`${scratch}/${file.name}`, file.bytes, file.executable);
      await new FileSource(scratch, this.fs, this.replace).materialize(dir);
    } finally {
      await this.fs.remove(scratch);
    }
  }

  private files(): PayloadFile[] {
    let value: unknown;
    try {
      value = YAML.parse(this.text);
    } catch {
      throw invalid('stdin must contain valid YAML or JSON');
    }
    if (!record(value) || !('source_version' in value))
      return [{ name: WORKSPACE_ENTRY, bytes: Buffer.from(this.text), executable: false }];
    if (value['source_version'] !== 1 || !record(value['files']))
      throw invalid('Expected source_version: 1 and a files mapping');
    const files = Object.entries(value['files']).map(([name, content]) => decode(name, content));
    if (!files.some((file) => file.name === WORKSPACE_ENTRY))
      throw invalid('The bundle requires manifest/workspace.yaml');
    for (const file of files)
      if (files.some((other) => other.name.startsWith(`${file.name}/`)))
        throw invalid(`A file overlaps a directory: ${file.name}`);
    return files;
  }
}

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function decode(name: string, content: unknown): PayloadFile {
  assertPayloadPath(name);
  if (name === 'docs' || name === 'skills') throw invalid(`${name} must contain files`);
  if (typeof content === 'string') return { name, bytes: Buffer.from(content), executable: false };
  if (
    !record(content) ||
    typeof content['base64'] !== 'string' ||
    (content['executable'] !== undefined && typeof content['executable'] !== 'boolean')
  )
    throw invalid(`${name} must be text or {base64, executable?}`);
  const bytes = Buffer.from(content['base64'], 'base64');
  if (bytes.toString('base64') !== content['base64']) throw invalid(`Invalid base64 for ${name}`);
  return { name, bytes, executable: content['executable'] === true };
}

function invalid(message: string): DevkitError {
  return new DevkitError('config', 'MANIFEST_SOURCE_INVALID', message, {
    nextSteps: [
      'Send a JSON object mapping manifest payload paths to text or {base64, executable?}, then retry.',
    ],
  });
}
