// Where the documents live under a manifest directory. The names use forward
// slashes on every platform, as Git paths and source payload entries do; the
// file system accepts them on Windows too.

export const MANIFEST_DIR = 'manifest';

export const MANIFEST_FILES = {
  workspace: `${MANIFEST_DIR}/workspace.yaml`,
  environments: `${MANIFEST_DIR}/environments.yaml`,
  tools: `${MANIFEST_DIR}/tools.yaml`,
  harness: `${MANIFEST_DIR}/harness.yaml`,
  members: `${MANIFEST_DIR}/members.yaml`,
} as const;
