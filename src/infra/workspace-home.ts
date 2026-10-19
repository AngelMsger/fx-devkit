// ~/.fx/workspaces/<name>/: everything fx keeps for one workspace besides the
// checkouts. The name is a path component, hence the guard.

import path from 'node:path';

import { assertWorkspaceName } from '../domain/workspace/name.js';

export function localLayerPath(home: string, name: string): string {
  return path.join(workspaceHome(home, name), 'local.yaml');
}

export function manifestSourceDir(home: string, name: string): string {
  return path.join(workspaceHome(home, name), 'source');
}

export function harnessStatePath(home: string, name: string): string {
  return path.join(workspaceHome(home, name), 'harness.json');
}

export function contributionJournalPath(home: string, name: string): string {
  return path.join(workspaceHome(home, name), 'contributions.json');
}

export function workspaceHome(home: string, name: string): string {
  assertWorkspaceName(name);
  return path.join(home, 'workspaces', name);
}
