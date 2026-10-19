// How a companion tool gets onto the machine. An installer only assembles the vector;
// running it is the use case's decision, after the dry-run and posture checks every
// write goes through.

import type { InstallVia } from '../domain/manifest/types.js';

// An installer is selected by the `via` of the install method it carries out.
export type InstallerId = InstallVia;

export interface VectorOptions {
  readonly registry?: string | undefined;
  readonly update: boolean;
  // Self-update pins its own scope while leaving other dependency registries to npm.
  readonly registryScope?: 'package';
}

export interface Installer {
  readonly id: InstallerId;
  available(): Promise<boolean>;
  vector(spec: string, options: VectorOptions): readonly string[] | undefined;
}
