// Turns what a person typed after --from into a ManifestSource. A git URL
// or a checkout is the manifest repository, cloned; a directory is copied;
// `-` is stdin. A resumed workspace reads its managed directory in place.

import path from 'node:path';

import { FileSource } from '../adapters/manifest-source/file.js';
import { GitRepoSource } from '../adapters/manifest-source/git-repo.js';
import { StdinSource } from '../adapters/manifest-source/stdin.js';
import type { ResumeInitDeps } from '../application/init/resume.js';
import type { InitDeps } from '../application/init/types.js';
import { isRepositoryUrl } from '../domain/manifest/source-repo.js';
import type { ManifestSource } from '../ports/manifest-source.js';
import type { ReplaceFiles } from '../ports/replace-files.js';

import type { Container } from './container.js';

export function resumeInitDeps(init: InitDeps, container: Container): ResumeInitDeps {
  return { ...init, inspectManaged: (dir) => new FileSource(dir, container.fs).inspect() };
}

export async function manifestSourceFor(
  spec: string,
  container: Container,
  stdin: () => Promise<string>,
  replace?: ReplaceFiles,
): Promise<ManifestSource> {
  if (spec === '-') return new StdinSource(await stdin(), container.fs, replace);
  if (isRepositoryUrl(spec))
    return new GitRepoSource(
      spec,
      container.process,
      container.git,
      (await container.fs.isDirectory(path.resolve(spec))) ? path.resolve(spec) : undefined,
      container.fs,
    );
  const dir = path.resolve(spec);
  if (await container.fs.exists(path.join(dir, '.git')))
    return new GitRepoSource(dir, container.process, container.git, dir, container.fs);
  return new FileSource(dir, container.fs, replace);
}
