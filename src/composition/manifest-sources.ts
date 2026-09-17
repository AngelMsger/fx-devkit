// Turns what a person typed after --from into a ManifestSource. A git URL
// or a checkout is the manifest repository, cloned; a directory is copied;
// `-` is stdin.

import path from 'node:path';

import { FileSource } from '../adapters/manifest-source/file.js';
import { GitRepoSource } from '../adapters/manifest-source/git-repo.js';
import { StdinSource } from '../adapters/manifest-source/stdin.js';
import { isRepositoryUrl } from '../domain/manifest/source-repo.js';
import type { ManifestSource } from '../ports/manifest-source.js';
import type { ReplaceFiles } from '../ports/replace-files.js';

import type { Container } from './container.js';

export async function manifestSourceFor(
  spec: string,
  container: Container,
  stdin: () => Promise<string>,
  replace?: ReplaceFiles,
): Promise<ManifestSource> {
  if (spec === '-') return new StdinSource(await stdin(), container.fs, replace);
  if (isRepositoryUrl(spec)) return new GitRepoSource(spec, container.process, container.git);
  const dir = path.resolve(spec);
  if (await container.fs.exists(path.join(dir, '.git')))
    return new GitRepoSource(dir, container.process, container.git, dir);
  return new FileSource(dir, container.fs, replace);
}
