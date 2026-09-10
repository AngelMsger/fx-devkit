// `go install`, which only ever fetches: a spec without a version is asked for
// `@latest`, so updating is the same request as installing.

import type { Installer, VectorOptions } from '../../ports/installer.js';
import type { Process } from '../../ports/process.js';

export class GoInstaller implements Installer {
  readonly id = 'go';

  constructor(private readonly process: Pick<Process, 'which'>) {}

  async available(): Promise<boolean> {
    return (await this.process.which('go')) !== undefined;
  }

  vector(spec: string, _options: VectorOptions): readonly string[] {
    return ['go', 'install', spec.includes('@') ? spec : `${spec}@latest`];
  }
}
