// How a companion tool gets onto the machine. An installer only assembles the vector;
// running it is the use case's decision, after the dry-run and posture checks every
// write goes through.

export type InstallerId = 'npm' | 'brew' | 'go' | 'manual';

export interface VectorOptions {
  readonly registry?: string | undefined;
  readonly update: boolean;
}

export interface Installer {
  readonly id: InstallerId;
  available(): Promise<boolean>;
  vector(spec: string, options: VectorOptions): readonly string[] | undefined;
}
