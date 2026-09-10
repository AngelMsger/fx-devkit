// Homebrew, which spells installing and upgrading differently; the requested
// operation picks the verb.

import type { Installer, VectorOptions } from '../../ports/installer.js';
import type { Process } from '../../ports/process.js';

export class BrewInstaller implements Installer {
  readonly id = 'brew';

  constructor(private readonly process: Pick<Process, 'which'>) {}

  async available(): Promise<boolean> {
    return (await this.process.which('brew')) !== undefined;
  }

  vector(spec: string, options: VectorOptions): readonly string[] {
    return ['brew', options.update ? 'upgrade' : 'install', spec];
  }
}
