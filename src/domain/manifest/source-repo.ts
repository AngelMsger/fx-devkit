// The manifest repository as a repository of its own workspace: named and
// placed on the code host by the source a person registered, checked out
// where fx materialized it. The manifest cannot list where it is kept, so
// the registry supplies this entry.

import path from 'node:path';

import { refFromUrl } from '../workspace/ref.js';

import type { ResolvedRepo } from './local.js';

const GIT_URL = /^(?:ssh:\/\/|git@|https?:\/\/|file:\/\/|git:\/\/)/;

export function isRepositoryUrl(spec: string): boolean {
  return GIT_URL.test(spec) || spec.endsWith('.git');
}

export function describeManifestRepo(source: string, dir: string, branch: string): ResolvedRepo {
  const isUrl = isRepositoryUrl(source);
  const ref = isUrl ? refFromUrl(source) : undefined;
  return {
    name: ref?.name ?? path.basename(source, '.git'),
    path: dir,
    branch,
    project: ref?.project,
    ...(isUrl ? { upstream: source } : {}),
    tags: [],
    origin: 'manifest',
    overridden: [],
  };
}
