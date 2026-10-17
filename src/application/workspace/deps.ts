// Everything a workspace use case can touch, in one object: the located
// workspace and the ports. The code host is a thunk because most commands
// never need it, and resolving it may fail for a workspace that has not
// bound one yet.

import type { Binding, PlatformBinding } from '../../domain/manifest/providers.js';
import type { Coordinate } from '../../domain/obs/types.js';
import type { ResolvedShell } from '../../domain/shell.js';
import type { Activity } from '../../ports/activity.js';
import type { CodeHost } from '../../ports/code-host.js';
import type { FileSystem } from '../../ports/fs.js';
import type { Git } from '../../ports/git.js';
import type { Platform } from '../../ports/platform.js';
import type { Process } from '../../ports/process.js';
import type { ProjectionStore } from '../../ports/projection.js';
import type { Reporter } from '../../ports/reporter.js';
import type { Cache, LocalLayerStore } from '../../ports/stores.js';

import type { WorkspaceContext } from './context.js';

export interface WorkspaceDeps {
  readonly commandShell?: ResolvedShell;
  readonly ctx: WorkspaceContext;
  readonly git: Git;
  readonly fs: FileSystem;
  readonly projections: ProjectionStore;
  readonly localStore: LocalLayerStore;
  readonly cache: Cache;
  readonly reporter: Reporter;
  readonly activity: Activity;
  readonly cliVersion: string;
  // The code-host user name from config.yaml, when the person set one; the
  // fork namespace when the host cannot say who they are.
  readonly user: string | undefined;
  readonly codeHost: () => CodeHost;
  // A platform instance from its binding; undefined when nothing serves it.
  readonly platform: (binding: PlatformBinding) => Platform | undefined;
  readonly reference: (binding: Binding) => Coordinate;
  readonly processRun: Process['run'];
  readonly processWhich: Process['which'];
}
