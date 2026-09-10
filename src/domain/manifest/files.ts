// Where the documents live under a manifest directory.

import path from 'node:path';

export const MANIFEST_DIR = 'manifest';

export const MANIFEST_FILES = {
  workspace: path.join(MANIFEST_DIR, 'workspace.yaml'),
  environments: path.join(MANIFEST_DIR, 'environments.yaml'),
  tools: path.join(MANIFEST_DIR, 'tools.yaml'),
  harness: path.join(MANIFEST_DIR, 'harness.yaml'),
  members: path.join(MANIFEST_DIR, 'members.yaml'),
} as const;
