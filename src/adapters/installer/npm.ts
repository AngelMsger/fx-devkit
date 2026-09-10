// npm's global install, with the registry passed through when the manifest
// names one.

import type { Installer, VectorOptions } from '../../ports/installer.js';
import type { Process } from '../../ports/process.js';
import { registryArguments } from '../registry/registry-policy.js';

export class NpmInstaller implements Installer {
  readonly id = 'npm';

  constructor(private readonly process: Pick<Process, 'which'>) {}

  async available(): Promise<boolean> {
    return (await this.process.which('npm')) !== undefined;
  }

  // Install and update are the same request: whatever `latest` is now.
  vector(spec: string, options: VectorOptions): readonly string[] {
    return [
      'npm',
      'install',
      '-g',
      `${spec}@latest`,
      ...(options.registry === undefined
        ? []
        : registryArguments({ packageName: spec, registry: options.registry })),
    ];
  }
}
